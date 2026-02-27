package service

import (
	"context"
	"fmt"
	"sync"
	"time"

	"notes/internal/dbclient"
	"notes/internal/domain"
	"notes/internal/secret"
	"notes/internal/storage"
)

// ─────────────────────────────────────────────────────────────
// Database Service — business logic for the Database plugin
// ─────────────────────────────────────────────────────────────

// CreateDBConnInput is the service-layer DTO for creating/updating connections.
// Defined here to avoid circular imports with the app package.
type CreateDBConnInput struct {
	Name     string `json:"name"`
	Driver   string `json:"driver"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Database string `json:"database"`
	Username string `json:"username"`
	Password string `json:"password"`
	SSLMode  string `json:"sslMode"`
}

// DatabaseService manages external database connections, query execution,
// and result caching. It uses a connector pool to reuse live connections.
type DatabaseService struct {
	connStore  *storage.DBConnectionStore
	secrets    secret.SecretStore
	blockStore *storage.BlockStore

	mu               sync.Mutex
	activeConnectors map[string]*connEntry
	cachedResults    map[string]*dbclient.QueryPage
}

type connEntry struct {
	connector dbclient.Connector
	createdAt time.Time
}

// NewDatabaseService creates a DatabaseService.
func NewDatabaseService(
	connStore *storage.DBConnectionStore,
	secrets secret.SecretStore,
	blockStore *storage.BlockStore,
) *DatabaseService {
	return &DatabaseService{
		connStore:        connStore,
		secrets:          secrets,
		blockStore:       blockStore,
		activeConnectors: make(map[string]*connEntry),
		cachedResults:    make(map[string]*dbclient.QueryPage),
	}
}

// ── Connection CRUD ────────────────────────────────────────

func (s *DatabaseService) ListConnections() ([]domain.DatabaseConnection, error) {
	return s.connStore.ListConnections()
}

func (s *DatabaseService) CreateConnection(input CreateDBConnInput) (*domain.DatabaseConnection, error) {
	conn := &domain.DatabaseConnection{
		Name:     input.Name,
		Driver:   domain.DatabaseDriver(input.Driver),
		Host:     input.Host,
		Port:     input.Port,
		Database: input.Database,
		Username: input.Username,
		SSLMode:  input.SSLMode,
	}
	if err := s.connStore.CreateConnection(conn); err != nil {
		return nil, fmt.Errorf("create connection: %w", err)
	}
	if input.Password != "" && s.secrets != nil {
		_ = s.secrets.Set("db:"+conn.ID, []byte(input.Password))
	}
	return conn, nil
}

func (s *DatabaseService) UpdateConnection(id string, input CreateDBConnInput) error {
	conn, err := s.connStore.GetConnection(id)
	if err != nil {
		return err
	}
	conn.Name = input.Name
	conn.Driver = domain.DatabaseDriver(input.Driver)
	conn.Host = input.Host
	conn.Port = input.Port
	conn.Database = input.Database
	conn.Username = input.Username
	conn.SSLMode = input.SSLMode
	if err := s.connStore.UpdateConnection(conn); err != nil {
		return err
	}
	if input.Password != "" && s.secrets != nil {
		_ = s.secrets.Set("db:"+id, []byte(input.Password))
	}
	// Invalidate cached connector so next query re-connects with new config.
	s.mu.Lock()
	if e, ok := s.activeConnectors[id]; ok {
		_ = e.connector.Close()
		delete(s.activeConnectors, id)
	}
	s.mu.Unlock()
	return nil
}

func (s *DatabaseService) DeleteConnection(id string) error {
	s.mu.Lock()
	if e, ok := s.activeConnectors[id]; ok {
		_ = e.connector.Close()
		delete(s.activeConnectors, id)
	}
	s.mu.Unlock()
	if s.secrets != nil {
		_ = s.secrets.Delete("db:" + id)
	}
	return s.connStore.DeleteConnection(id)
}

// ── Query Execution ────────────────────────────────────────

// ExecuteQuery runs a query and caches the result against blockID.
func (s *DatabaseService) ExecuteQuery(
	ctx context.Context,
	blockID, connectionID, query string,
	fetchSize int,
) (*dbclient.QueryPage, error) {
	connector, err := s.getOrCreate(connectionID)
	if err != nil {
		return nil, err
	}
	result, err := connector.Execute(ctx, query, fetchSize)
	if err != nil {
		return nil, fmt.Errorf("execute query: %w", err)
	}
	s.mu.Lock()
	s.cachedResults[blockID] = result
	s.mu.Unlock()
	return result, nil
}

// FetchMoreRows fetches the next page of results for a connection.
func (s *DatabaseService) FetchMoreRows(
	ctx context.Context,
	connectionID string,
	fetchSize int,
) (*dbclient.QueryPage, error) {
	s.mu.Lock()
	entry, ok := s.activeConnectors[connectionID]
	s.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("no active query for connection %s", connectionID)
	}
	return entry.connector.FetchMore(ctx, fetchSize)
}

// GetCachedResult returns the last cached query result for a block, or nil.
func (s *DatabaseService) GetCachedResult(blockID string) *dbclient.QueryPage {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cachedResults[blockID]
}

// ClearCachedResult removes the cached result for a block.
func (s *DatabaseService) ClearCachedResult(blockID string) {
	s.mu.Lock()
	delete(s.cachedResults, blockID)
	s.mu.Unlock()
}

// ── Test + Introspect ──────────────────────────────────────

func (s *DatabaseService) TestConnection(ctx context.Context, id string) error {
	connector, err := s.getOrCreate(id)
	if err != nil {
		return err
	}
	return connector.TestConnection(ctx)
}

func (s *DatabaseService) Introspect(ctx context.Context, connectionID string) (*dbclient.SchemaInfo, error) {
	connector, err := s.getOrCreate(connectionID)
	if err != nil {
		return nil, err
	}
	return connector.Introspect(ctx)
}

func (s *DatabaseService) ApplyMutations(
	ctx context.Context,
	connectionID, table string,
	mutations []dbclient.Mutation,
) (*dbclient.MutationResult, error) {
	connector, err := s.getOrCreate(connectionID)
	if err != nil {
		return nil, err
	}
	return connector.ApplyMutations(ctx, table, mutations)
}

// ── Connector Pool ─────────────────────────────────────────

func (s *DatabaseService) getOrCreate(id string) (dbclient.Connector, error) {
	s.mu.Lock()
	if e, ok := s.activeConnectors[id]; ok {
		s.mu.Unlock()
		return e.connector, nil
	}
	s.mu.Unlock()

	conn, err := s.connStore.GetConnection(id)
	if err != nil {
		return nil, fmt.Errorf("get connection %s: %w", id, err)
	}

	var password string
	if s.secrets != nil {
		if pw, err := s.secrets.Get("db:" + id); err == nil {
			password = string(pw)
		}
	}

	connector, err := dbclient.NewConnector(conn, password)
	if err != nil {
		return nil, fmt.Errorf("open db connection: %w", err)
	}

	s.mu.Lock()
	s.activeConnectors[id] = &connEntry{connector: connector, createdAt: time.Now()}
	s.mu.Unlock()
	return connector, nil
}

// Close tears down all active database connectors.
func (s *DatabaseService) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, entry := range s.activeConnectors {
		_ = entry.connector.Close()
		delete(s.activeConnectors, id)
	}
}
