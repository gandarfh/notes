package app

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"notes/internal/dbclient"
	"notes/internal/domain"
)

// ============================================================
// Database Plugin
// ============================================================

func (a *App) ListDatabaseConnections() ([]DBConnView, error) {
	conns, err := a.dbConnStore.ListConnections()
	if err != nil {
		return nil, err
	}
	views := make([]DBConnView, len(conns))
	for i, c := range conns {
		views[i] = DBConnView{
			ID: c.ID, Name: c.Name, Driver: string(c.Driver),
			Host: c.Host, Port: c.Port, Database: c.Database,
			Username: c.Username, SSLMode: c.SSLMode,
		}
	}
	return views, nil
}

func (a *App) CreateDatabaseConnection(input CreateDBConnInput) (*DBConnView, error) {
	id := uuid.New().String()
	conn := &domain.DatabaseConnection{
		ID:       id,
		Name:     input.Name,
		Driver:   domain.DatabaseDriver(input.Driver),
		Host:     input.Host,
		Port:     input.Port,
		Database: input.Database,
		Username: input.Username,
		SSLMode:  input.SSLMode,
	}

	if err := a.dbConnStore.CreateConnection(conn); err != nil {
		return nil, fmt.Errorf("save connection: %w", err)
	}

	// Store password in Keychain
	if input.Password != "" {
		if err := a.secrets.Set("notes-db:conn:"+id, []byte(input.Password)); err != nil {
			// Rollback DB entry
			a.dbConnStore.DeleteConnection(id)
			return nil, fmt.Errorf("save password: %w", err)
		}
	}

	return &DBConnView{
		ID: id, Name: input.Name, Driver: input.Driver,
		Host: input.Host, Port: input.Port, Database: input.Database,
		Username: input.Username, SSLMode: input.SSLMode,
	}, nil
}

func (a *App) UpdateDatabaseConnection(id string, input CreateDBConnInput) error {
	conn, err := a.dbConnStore.GetConnection(id)
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

	if err := a.dbConnStore.UpdateConnection(conn); err != nil {
		return err
	}

	// Update password if provided
	if input.Password != "" {
		if err := a.secrets.Set("notes-db:conn:"+id, []byte(input.Password)); err != nil {
			return fmt.Errorf("update password: %w", err)
		}
	}

	// Close cached connector if exists (force reconnect)
	a.connectorsMu.Lock()
	if c, ok := a.activeConnectors[id]; ok {
		c.Close()
		delete(a.activeConnectors, id)
	}
	a.connectorsMu.Unlock()

	return nil
}

func (a *App) DeleteDatabaseConnection(id string) error {
	// Close cached connector
	a.connectorsMu.Lock()
	if c, ok := a.activeConnectors[id]; ok {
		c.Close()
		delete(a.activeConnectors, id)
	}
	a.connectorsMu.Unlock()

	// Delete from keychain
	a.secrets.Delete("notes-db:conn:" + id)

	return a.dbConnStore.DeleteConnection(id)
}

func (a *App) TestDatabaseConnection(id string) error {
	connector, err := a.getOrCreateConnector(id)
	if err != nil {
		return err
	}
	return connector.TestConnection(context.Background())
}

func (a *App) IntrospectDatabase(connectionID string) (*dbclient.SchemaInfo, error) {
	connector, err := a.getOrCreateConnector(connectionID)
	if err != nil {
		return nil, err
	}
	return connector.Introspect(context.Background())
}

func (a *App) ExecuteQuery(blockID, connectionID, query string, fetchSize int) (*QueryResultView, error) {
	wailsRuntime.LogDebugf(a.ctx, "[DB] ExecuteQuery blockID=%s connID=%s fetchSize=%d", blockID, connectionID, fetchSize)
	wailsRuntime.LogDebugf(a.ctx, "[DB] Query: %s", query)

	connector, err := a.getOrCreateConnector(connectionID)
	if err != nil {
		wailsRuntime.LogErrorf(a.ctx, "[DB] getOrCreateConnector failed: %v", err)
		return nil, err
	}

	if fetchSize <= 0 {
		fetchSize = 50
	}

	start := time.Now()
	page, err := connector.Execute(context.Background(), query, fetchSize)
	durationMs := int(time.Since(start).Milliseconds())

	wailsRuntime.LogDebugf(a.ctx, "[DB] Execute done in %dms, err=%v", durationMs, err)

	if err != nil {
		wailsRuntime.LogErrorf(a.ctx, "[DB] Execute error: %v", err)
		// Cache the error result
		result := &domain.QueryResult{
			ID:          uuid.New().String(),
			BlockID:     blockID,
			Query:       query,
			ColumnsJSON: "[]",
			RowsJSON:    "[]",
			DurationMs:  durationMs,
			Error:       err.Error(),
		}
		a.dbResultStore.UpsertResult(result)
		return &QueryResultView{Error: err.Error(), DurationMs: durationMs, Query: query}, nil
	}

	wailsRuntime.LogDebugf(a.ctx, "[DB] Page: cols=%d rows=%d totalFetched=%d hasMore=%v isWrite=%v",
		len(page.Columns), len(page.Rows), page.TotalFetched, page.HasMore, page.IsWrite)

	// Serialize to JSON for caching
	colJSON, _ := json.Marshal(page.Columns)
	rowJSON, _ := json.Marshal(page.Rows)

	result := &domain.QueryResult{
		ID:           uuid.New().String(),
		BlockID:      blockID,
		Query:        query,
		ColumnsJSON:  string(colJSON),
		RowsJSON:     string(rowJSON),
		TotalRows:    page.TotalFetched,
		HasMore:      page.HasMore,
		DurationMs:   durationMs,
		IsWrite:      page.IsWrite,
		AffectedRows: page.AffectedRows,
	}
	a.dbResultStore.UpsertResult(result)

	return &QueryResultView{
		Columns:      page.Columns,
		Rows:         page.Rows,
		TotalRows:    page.TotalFetched,
		HasMore:      page.HasMore,
		DurationMs:   durationMs,
		IsWrite:      page.IsWrite,
		AffectedRows: page.AffectedRows,
		Query:        query,
		PrimaryKeys:  page.PrimaryKeys,
	}, nil
}

func (a *App) FetchMoreRows(connectionID string, fetchSize int) (*QueryResultView, error) {
	connector, err := a.getOrCreateConnector(connectionID)
	if err != nil {
		return nil, err
	}

	start := time.Now()
	page, err := connector.FetchMore(context.Background(), fetchSize)
	durationMs := int(time.Since(start).Milliseconds())

	if err != nil {
		return &QueryResultView{Error: err.Error(), DurationMs: durationMs}, nil
	}

	return &QueryResultView{
		Columns:      page.Columns,
		Rows:         page.Rows,
		TotalRows:    page.TotalFetched,
		HasMore:      page.HasMore,
		DurationMs:   durationMs,
		IsWrite:      page.IsWrite,
		AffectedRows: page.AffectedRows,
		PrimaryKeys:  page.PrimaryKeys,
	}, nil
}

func (a *App) ApplyMutations(connectionID, table string, mutations []dbclient.Mutation) (*dbclient.MutationResult, error) {
	connector, err := a.getOrCreateConnector(connectionID)
	if err != nil {
		return nil, err
	}
	return connector.ApplyMutations(context.Background(), table, mutations)
}

func (a *App) GetCachedResult(blockID string) (*QueryResultView, error) {
	result, err := a.dbResultStore.GetResultByBlock(blockID)
	if err != nil {
		return nil, err
	}
	if result == nil {
		return nil, nil
	}

	var columns []string
	var rows [][]any
	json.Unmarshal([]byte(result.ColumnsJSON), &columns)
	json.Unmarshal([]byte(result.RowsJSON), &rows)

	return &QueryResultView{
		Columns:      columns,
		Rows:         rows,
		TotalRows:    result.TotalRows,
		HasMore:      result.HasMore,
		DurationMs:   result.DurationMs,
		Error:        result.Error,
		IsWrite:      result.IsWrite,
		AffectedRows: result.AffectedRows,
		Query:        result.Query,
	}, nil
}

func (a *App) ClearCachedResult(blockID string) error {
	return a.dbResultStore.DeleteResultsByBlock(blockID)
}

func (a *App) SaveBlockDatabaseConfig(blockID string, config string) error {
	b, err := a.blocks.GetBlock(blockID)
	if err != nil {
		return err
	}
	b.Content = config
	return a.blocks.UpdateBlock(b)
}

// getOrCreateConnector retrieves a cached connector or creates a new one.
func (a *App) getOrCreateConnector(connID string) (dbclient.Connector, error) {
	a.connectorsMu.Lock()
	defer a.connectorsMu.Unlock()

	if c, ok := a.activeConnectors[connID]; ok {
		return c, nil
	}

	conn, err := a.dbConnStore.GetConnection(connID)
	if err != nil {
		return nil, fmt.Errorf("connection not found: %w", err)
	}

	// Retrieve password from Keychain
	password := ""
	pwBytes, err := a.secrets.Get("notes-db:conn:" + connID)
	if err == nil && pwBytes != nil {
		password = string(pwBytes)
	}

	connector, err := dbclient.NewConnector(conn, password)
	if err != nil {
		return nil, fmt.Errorf("create connector: %w", err)
	}

	a.activeConnectors[connID] = connector
	return connector, nil
}
