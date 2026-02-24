package dbclient

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"notes/internal/domain"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// mongoConnector implements Connector for MongoDB.
type mongoConnector struct {
	client *mongo.Client
	dbName string

	mu         sync.Mutex
	cursor     *mongo.Cursor
	lastAccess time.Time
	fetched    int
}

// mongoQuery is the JSON structure users write for MongoDB queries.
type mongoQuery struct {
	Collection string         `json:"collection"`
	Operation  string         `json:"operation,omitempty"` // find (default), insertOne, updateMany, deleteMany, aggregate
	Filter     map[string]any `json:"filter,omitempty"`
	Projection map[string]any `json:"projection,omitempty"`
	Sort       map[string]any `json:"sort,omitempty"`
	Document   map[string]any `json:"document,omitempty"` // for inserts
	Update     map[string]any `json:"update,omitempty"`   // for updates
	Pipeline   []any          `json:"pipeline,omitempty"` // for aggregate
}

func newMongoConnector(conn *domain.DatabaseConnection, password string) (*mongoConnector, error) {
	var uri string

	// If host is already a full connection string (Atlas mongodb+srv:// or standard mongodb://),
	// use it directly. Otherwise, build the URI from host:port.
	if strings.HasPrefix(conn.Host, "mongodb+srv://") || strings.HasPrefix(conn.Host, "mongodb://") {
		uri = conn.Host
		// Replace <password> placeholder commonly found in Atlas connection strings
		if password != "" {
			uri = strings.ReplaceAll(uri, "<password>", password)
			uri = strings.ReplaceAll(uri, "<db_password>", password)
		}
		// Append database name to path if not already in URI
		if conn.Database != "" && !strings.Contains(uri, "/"+conn.Database) {
			// Insert database after the host part, before query params
			if idx := strings.Index(uri, "?"); idx != -1 {
				uri = uri[:idx] + "/" + conn.Database + uri[idx:]
			} else {
				// Ensure no trailing slash duplication
				uri = strings.TrimRight(uri, "/") + "/" + conn.Database
			}
		}
	} else {
		port := conn.Port
		if port == 0 {
			port = 27017
		}
		if conn.Username != "" {
			uri = fmt.Sprintf("mongodb://%s:%s@%s:%d", conn.Username, password, conn.Host, port)
		} else {
			uri = fmt.Sprintf("mongodb://%s:%d", conn.Host, port)
		}

		// Parse extraJSON for authSource, replicaSet, etc.
		if conn.ExtraJSON != "" && conn.ExtraJSON != "{}" {
			var extras map[string]string
			if json.Unmarshal([]byte(conn.ExtraJSON), &extras) == nil {
				params := []string{}
				for k, v := range extras {
					params = append(params, k+"="+v)
				}
				if len(params) > 0 {
					uri += "?" + strings.Join(params, "&")
				}
			}
		}
	}

	dbName := conn.Database
	if dbName == "" {
		// Try to extract database name from the URI path (e.g., mongodb+srv://...@host/mydb?...)
		uriForParse := uri
		// Strip scheme prefix to find the path part
		for _, prefix := range []string{"mongodb+srv://", "mongodb://"} {
			if strings.HasPrefix(uriForParse, prefix) {
				uriForParse = uriForParse[len(prefix):]
				break
			}
		}
		// Find the path after the host: user:pass@host/DB_NAME?params
		if atIdx := strings.Index(uriForParse, "@"); atIdx != -1 {
			uriForParse = uriForParse[atIdx+1:]
		}
		if slashIdx := strings.Index(uriForParse, "/"); slashIdx != -1 {
			pathPart := uriForParse[slashIdx+1:]
			if qIdx := strings.Index(pathPart, "?"); qIdx != -1 {
				pathPart = pathPart[:qIdx]
			}
			if pathPart != "" {
				dbName = pathPart
			}
		}
		if dbName == "" {
			dbName = "test"
		}
	}

	// Mask password in URI for logging
	logURI := uri
	if password != "" && strings.Contains(logURI, password) {
		logURI = strings.ReplaceAll(logURI, password, "***")
	}
	log.Printf("[MONGO] Connecting with URI: %s", logURI)
	log.Printf("[MONGO] Database: %s", dbName)

	clientOpts := options.Client().ApplyURI(uri)
	client, err := mongo.Connect(clientOpts)
	if err != nil {
		log.Printf("[MONGO] Connect failed: %v", err)
		return nil, fmt.Errorf("connect mongo: %w", err)
	}

	log.Printf("[MONGO] Client created successfully")
	return &mongoConnector{
		client: client,
		dbName: dbName,
	}, nil
}

// unmarshalEJSON re-encodes a map[string]any field and uses bson.UnmarshalExtJSON
// to convert MongoDB Extended JSON types ($oid, $date, $numberLong, etc.) to BSON.
func unmarshalEJSON(field map[string]any) map[string]any {
	if field == nil {
		return nil
	}
	// Re-marshal the field to JSON bytes
	raw, err := json.Marshal(field)
	if err != nil {
		return field // fallback to original
	}
	// Unmarshal with Extended JSON (relaxed mode) into bson.D then convert to bson.M
	var doc bson.D
	if err := bson.UnmarshalExtJSON(raw, false, &doc); err != nil {
		log.Printf("[MONGO] EJSON parse warning: %v", err)
		return field // fallback to standard JSON parse
	}
	// Convert bson.D to map[string]any for compatibility
	result := make(map[string]any, len(doc))
	for _, elem := range doc {
		result[elem.Key] = elem.Value
	}
	return result
}

// parseObjectID parses an ObjectID from either raw hex "67b8f1..."
// or the wrapped format ObjectID("67b8f1...") produced by fmt.Sprintf("%v").
func parseObjectID(s string) (bson.ObjectID, error) {
	// Try raw hex first
	if oid, err := bson.ObjectIDFromHex(s); err == nil {
		return oid, nil
	}
	// Try ObjectID("...") wrapper
	if strings.HasPrefix(s, "ObjectID(\"") && strings.HasSuffix(s, "\")") {
		hex := s[len("ObjectID(\"") : len(s)-len("\")")]
		return bson.ObjectIDFromHex(hex)
	}
	return bson.ObjectID{}, fmt.Errorf("invalid ObjectID: %s", s)
}

func (m *mongoConnector) TestConnection(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return m.client.Ping(ctx, nil)
}

func (m *mongoConnector) Execute(ctx context.Context, query string, fetchSize int) (*QueryPage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.closeCursorLocked(ctx)

	if fetchSize <= 0 {
		fetchSize = 50
	}

	// First pass: standard JSON unmarshal for the query structure
	var mq mongoQuery
	if err := json.Unmarshal([]byte(query), &mq); err != nil {
		log.Printf("[MONGO] JSON parse error: %v (raw: %s)", err, query)
		return nil, fmt.Errorf("invalid query JSON: %w", err)
	}

	// Second pass: unmarshal BSON-typed fields with Extended JSON (handles $oid, $date, etc.)
	mq.Filter = unmarshalEJSON(mq.Filter)
	mq.Document = unmarshalEJSON(mq.Document)
	mq.Update = unmarshalEJSON(mq.Update)
	mq.Projection = unmarshalEJSON(mq.Projection)
	mq.Sort = unmarshalEJSON(mq.Sort)

	log.Printf("[MONGO] Parsed query: collection=%q operation=%q filter=%v", mq.Collection, mq.Operation, mq.Filter)

	if mq.Collection == "" {
		return nil, fmt.Errorf("query must specify 'collection'")
	}

	coll := m.client.Database(m.dbName).Collection(mq.Collection)

	op := mq.Operation
	if op == "" {
		op = "find"
	}

	switch op {
	case "find":
		return m.execFind(ctx, coll, mq, fetchSize)
	case "aggregate":
		return m.execAggregate(ctx, coll, mq, fetchSize)
	case "insertOne":
		return m.execInsertOne(ctx, coll, mq)
	case "updateMany":
		return m.execUpdateMany(ctx, coll, mq)
	case "deleteMany":
		return m.execDeleteMany(ctx, coll, mq)
	default:
		return nil, fmt.Errorf("unsupported operation: %s", op)
	}
}

func (m *mongoConnector) execFind(ctx context.Context, coll *mongo.Collection, mq mongoQuery, fetchSize int) (*QueryPage, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	opts := options.Find()
	if mq.Projection != nil {
		opts.SetProjection(mq.Projection)
	}
	if mq.Sort != nil {
		opts.SetSort(mq.Sort)
	}
	opts.SetBatchSize(int32(fetchSize))

	filter := mq.Filter
	if filter == nil {
		filter = map[string]any{}
	}

	cursor, err := coll.Find(ctx, filter, opts)
	if err != nil {
		log.Printf("[MONGO] Find error: %v", err)
		return nil, fmt.Errorf("find: %w", err)
	}

	log.Printf("[MONGO] Find cursor created, fetching batch of %d", fetchSize)

	m.cursor = cursor
	m.fetched = 0
	m.lastAccess = time.Now()

	return m.fetchMongoBatchLocked(ctx, fetchSize)
}

func (m *mongoConnector) execAggregate(ctx context.Context, coll *mongo.Collection, mq mongoQuery, fetchSize int) (*QueryPage, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	pipeline := mq.Pipeline
	if pipeline == nil {
		pipeline = []any{}
	}

	cursor, err := coll.Aggregate(ctx, pipeline)
	if err != nil {
		return nil, fmt.Errorf("aggregate: %w", err)
	}

	m.cursor = cursor
	m.fetched = 0
	m.lastAccess = time.Now()

	return m.fetchMongoBatchLocked(ctx, fetchSize)
}

func (m *mongoConnector) execInsertOne(ctx context.Context, coll *mongo.Collection, mq mongoQuery) (*QueryPage, error) {
	doc := mq.Document
	if doc == nil {
		return nil, fmt.Errorf("insertOne requires 'document'")
	}
	_, err := coll.InsertOne(ctx, doc)
	if err != nil {
		return nil, fmt.Errorf("insertOne: %w", err)
	}
	return &QueryPage{IsWrite: true, AffectedRows: 1}, nil
}

func (m *mongoConnector) execUpdateMany(ctx context.Context, coll *mongo.Collection, mq mongoQuery) (*QueryPage, error) {
	filter := mq.Filter
	if filter == nil {
		filter = map[string]any{}
	}
	update := mq.Update
	if update == nil {
		return nil, fmt.Errorf("updateMany requires 'update'")
	}
	result, err := coll.UpdateMany(ctx, filter, update)
	if err != nil {
		return nil, fmt.Errorf("updateMany: %w", err)
	}
	return &QueryPage{IsWrite: true, AffectedRows: int(result.ModifiedCount)}, nil
}

func (m *mongoConnector) execDeleteMany(ctx context.Context, coll *mongo.Collection, mq mongoQuery) (*QueryPage, error) {
	filter := mq.Filter
	if filter == nil {
		filter = map[string]any{}
	}
	result, err := coll.DeleteMany(ctx, filter)
	if err != nil {
		return nil, fmt.Errorf("deleteMany: %w", err)
	}
	return &QueryPage{IsWrite: true, AffectedRows: int(result.DeletedCount)}, nil
}

func (m *mongoConnector) FetchMore(ctx context.Context, fetchSize int) (*QueryPage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.cursor == nil {
		return nil, fmt.Errorf("no active cursor — execute a query first")
	}
	if fetchSize <= 0 {
		fetchSize = 50
	}
	m.lastAccess = time.Now()
	return m.fetchMongoBatchLocked(ctx, fetchSize)
}

func (m *mongoConnector) fetchMongoBatchLocked(ctx context.Context, fetchSize int) (*QueryPage, error) {
	var docs []bson.D
	for i := 0; i < fetchSize; i++ {
		if !m.cursor.Next(ctx) {
			break
		}
		var doc bson.D
		if err := m.cursor.Decode(&doc); err != nil {
			return nil, fmt.Errorf("decode: %w", err)
		}
		docs = append(docs, doc)
	}

	// Check if cursor stopped due to an error (not just end of results)
	if err := m.cursor.Err(); err != nil {
		log.Printf("[MONGO] Cursor error after fetch: %v", err)
		return nil, fmt.Errorf("cursor error: %w", err)
	}

	log.Printf("[MONGO] Fetched %d docs (total: %d)", len(docs), m.fetched+len(docs))

	m.fetched += len(docs)

	// Extract columns from all docs, preserving insertion order
	colSet := map[string]bool{}
	var columns []string
	for _, doc := range docs {
		for _, elem := range doc {
			if !colSet[elem.Key] {
				colSet[elem.Key] = true
				columns = append(columns, elem.Key)
			}
		}
	}
	// Sort columns deterministically: _id first, then alphabetical
	sort.SliceStable(columns, func(i, j int) bool {
		if columns[i] == "_id" {
			return true
		}
		if columns[j] == "_id" {
			return false
		}
		return columns[i] < columns[j]
	})

	// Convert docs to row arrays
	var rows [][]any
	for _, doc := range docs {
		row := make([]any, len(columns))
		// Build a lookup from the ordered doc
		docMap := make(map[string]any, len(doc))
		for _, elem := range doc {
			docMap[elem.Key] = elem.Value
		}
		for j, col := range columns {
			if v, ok := docMap[col]; ok {
				row[j] = fmt.Sprintf("%v", v)
			}
		}
		rows = append(rows, row)
	}

	hasMore := len(docs) == fetchSize
	if !hasMore {
		m.closeCursorLocked(ctx)
	}

	return &QueryPage{
		Columns:      columns,
		Rows:         rows,
		TotalFetched: m.fetched,
		HasMore:      hasMore,
		PrimaryKeys:  []string{"_id"},
	}, nil
}

func (m *mongoConnector) Introspect(ctx context.Context) (*SchemaInfo, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	db := m.client.Database(m.dbName)

	collections, err := db.ListCollectionNames(ctx, bson.M{})
	if err != nil {
		return nil, fmt.Errorf("list collections: %w", err)
	}

	schema := &SchemaInfo{}
	for _, collName := range collections {
		// Sample one document to extract field names
		coll := db.Collection(collName)
		cursor, err := coll.Find(ctx, bson.M{}, options.Find().SetLimit(1))
		if err != nil {
			schema.Tables = append(schema.Tables, TableInfo{Name: collName})
			continue
		}

		var cols []ColumnInfo
		if cursor.Next(ctx) {
			var doc bson.M
			if cursor.Decode(&doc) == nil {
				for k, v := range doc {
					cols = append(cols, ColumnInfo{
						Name: k,
						Type: fmt.Sprintf("%T", v),
					})
				}
			}
		}
		cursor.Close(ctx)

		schema.Tables = append(schema.Tables, TableInfo{Name: collName, Columns: cols})
	}

	return schema, nil
}

func (m *mongoConnector) ApplyMutations(ctx context.Context, table string, mutations []Mutation) (*MutationResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	coll := m.client.Database(m.dbName).Collection(table)
	result := &MutationResult{}

	for _, mut := range mutations {
		var execErr error
		// Build filter from RowKey — convert _id strings to ObjectID if possible
		filter := bson.M{}
		for k, v := range mut.RowKey {
			if k == "_id" {
				if idStr, ok := v.(string); ok {
					if oid, err := parseObjectID(idStr); err == nil {
						filter[k] = oid
					} else {
						filter[k] = v
					}
				} else {
					filter[k] = v
				}
			} else {
				filter[k] = v
			}
		}

		log.Printf("[MONGO] Mutation: type=%s filter=%v changes=%v", mut.Type, filter, mut.Changes)

		switch mut.Type {
		case "update":
			if len(mut.Changes) == 0 {
				continue
			}
			// Convert changes to bson.M for proper driver handling
			setDoc := bson.M{}
			for k, v := range mut.Changes {
				setDoc[k] = v
			}
			update := bson.M{"$set": setDoc}
			res, err := coll.UpdateOne(ctx, filter, update)
			if err != nil {
				execErr = err
			} else {
				log.Printf("[MONGO] UpdateOne: matched=%d modified=%d", res.MatchedCount, res.ModifiedCount)
				if res.MatchedCount == 0 {
					execErr = fmt.Errorf("update matched 0 documents for filter %v", filter)
				}
			}
		case "delete":
			_, execErr = coll.DeleteOne(ctx, filter)
		default:
			execErr = fmt.Errorf("unknown mutation type: %s", mut.Type)
		}

		if execErr != nil {
			result.Errors = append(result.Errors, execErr.Error())
		} else {
			result.Applied++
		}
	}
	return result, nil
}

func (m *mongoConnector) Close() error {
	m.mu.Lock()
	m.closeCursorLocked(context.Background())
	m.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return m.client.Disconnect(ctx)
}

func (m *mongoConnector) closeCursorLocked(ctx context.Context) {
	if m.cursor != nil {
		m.cursor.Close(ctx)
		m.cursor = nil
	}
}
