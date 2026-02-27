package app

// ─────────────────────────────────────────────────────────────
// Database Handlers — thin delegates to DatabaseService
// ─────────────────────────────────────────────────────────────
// Note: PickDatabaseFile is already declared in app_connection.go.

import (
	"notes/internal/dbclient"
	"notes/internal/domain"
	"notes/internal/service"
)

// ListDatabaseConnections returns all configured external database connections.
func (a *App) ListDatabaseConnections() ([]domain.DatabaseConnection, error) {
	return a.database.ListConnections()
}

func (a *App) CreateDatabaseConnection(input CreateDBConnInput) (*domain.DatabaseConnection, error) {
	return a.database.CreateConnection(service.CreateDBConnInput{
		Name:     input.Name,
		Driver:   input.Driver,
		Host:     input.Host,
		Port:     input.Port,
		Database: input.Database,
		Username: input.Username,
		Password: input.Password,
		SSLMode:  input.SSLMode,
	})
}

func (a *App) UpdateDatabaseConnection(id string, input CreateDBConnInput) error {
	return a.database.UpdateConnection(id, service.CreateDBConnInput{
		Name:     input.Name,
		Driver:   input.Driver,
		Host:     input.Host,
		Port:     input.Port,
		Database: input.Database,
		Username: input.Username,
		Password: input.Password,
		SSLMode:  input.SSLMode,
	})
}

func (a *App) DeleteDatabaseConnection(id string) error {
	return a.database.DeleteConnection(id)
}

func (a *App) TestDatabaseConnection(id string) error {
	return a.database.TestConnection(a.ctx, id)
}

func (a *App) IntrospectDatabase(connectionID string) (*dbclient.SchemaInfo, error) {
	return a.database.Introspect(a.ctx, connectionID)
}

func (a *App) ExecuteQuery(blockID, connectionID, query string, fetchSize int) (*QueryResultView, error) {
	page, err := a.database.ExecuteQuery(a.ctx, blockID, connectionID, query, fetchSize)
	if err != nil {
		return nil, err
	}
	return queryPageToView(page, query), nil
}

func (a *App) FetchMoreRows(connectionID string, fetchSize int) (*QueryResultView, error) {
	page, err := a.database.FetchMoreRows(a.ctx, connectionID, fetchSize)
	if err != nil {
		return nil, err
	}
	return queryPageToView(page, ""), nil
}

func (a *App) GetCachedResult(blockID string) *QueryResultView {
	page := a.database.GetCachedResult(blockID)
	if page == nil {
		return nil
	}
	return queryPageToView(page, "")
}

func (a *App) ClearCachedResult(blockID string) error {
	a.database.ClearCachedResult(blockID)
	return nil
}

func (a *App) SaveBlockDatabaseConfig(blockID, config string) error {
	return a.blocks.UpdateBlockContent(blockID, config)
}

func (a *App) ApplyMutations(connectionID, table string, mutations []dbclient.Mutation) (*dbclient.MutationResult, error) {
	return a.database.ApplyMutations(a.ctx, connectionID, table, mutations)
}

// queryPageToView converts a service-layer QueryPage to the frontend-safe QueryResultView.
func queryPageToView(p *dbclient.QueryPage, query string) *QueryResultView {
	return &QueryResultView{
		Columns:      p.Columns,
		Rows:         p.Rows,
		HasMore:      p.HasMore,
		IsWrite:      p.IsWrite,
		AffectedRows: p.AffectedRows,
		Query:        query,
		PrimaryKeys:  p.PrimaryKeys,
	}
}
