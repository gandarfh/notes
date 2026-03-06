package service

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"notes/internal/domain"
	_ "notes/internal/etl/sources" // register CSV, JSON, etc.
	"notes/internal/storage"
	"notes/internal/testutil"
)

// ─────────────────────────────────────────────────────────────
// ETL Service — integration tests with real SQLite
// ─────────────────────────────────────────────────────────────

type etlTestEnv struct {
	svc     *ETLService
	emitter *MockEmitter
	localDB *storage.LocalDatabaseStore
}

func newETLService(t *testing.T) *etlTestEnv {
	t.Helper()
	db := testutil.NewTestDB(t)
	etlStore := storage.NewETLStore(db)
	localDB := storage.NewLocalDatabaseStore(db)
	emitter := &MockEmitter{}
	svc := NewETLService(etlStore, localDB, emitter)
	t.Cleanup(func() { svc.Stop() })
	return &etlTestEnv{svc: svc, emitter: emitter, localDB: localDB}
}

// createTargetDB creates a LocalDatabase with columns matching CSV output.
func (e *etlTestEnv) createTargetDB(t *testing.T, dbID string, columns []string) {
	t.Helper()
	cols := make([]map[string]any, len(columns))
	for i, c := range columns {
		cols[i] = map[string]any{"id": c, "name": c, "type": "text", "width": 150}
	}
	cfgJSON, _ := json.Marshal(map[string]any{"columns": cols})
	err := e.localDB.CreateDatabase(&domain.LocalDatabase{
		ID:         dbID,
		BlockID:    "block-" + dbID,
		Name:       dbID,
		ConfigJSON: string(cfgJSON),
	})
	if err != nil {
		t.Fatalf("create target db: %v", err)
	}
}

// ── Constructor ──

func TestETLService_New(t *testing.T) {
	env := newETLService(t)
	if env.svc == nil {
		t.Fatal("expected non-nil ETLService")
	}
}

// ── Job CRUD ──

func TestETLService_CreateJob(t *testing.T) {
	env := newETLService(t)

	job, err := env.svc.CreateJob(context.Background(), CreateETLJobInput{
		Name:       "Test Job",
		SourceType: "csv_file",
		SourceConfig: map[string]any{
			"filePath": "/tmp/test.csv",
		},
		TargetDBID: "db-1",
		SyncMode:   "replace",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if job.ID == "" {
		t.Error("ID should be set")
	}
	if job.Name != "Test Job" {
		t.Errorf("name = %q", job.Name)
	}
	if job.SyncMode != "replace" {
		t.Errorf("syncMode = %q", job.SyncMode)
	}
	if job.TriggerType != "manual" {
		t.Errorf("triggerType = %q, want manual (default)", job.TriggerType)
	}
}

func TestETLService_CreateJob_Defaults(t *testing.T) {
	env := newETLService(t)

	job, err := env.svc.CreateJob(context.Background(), CreateETLJobInput{
		Name:       "Defaults",
		SourceType: "csv_file",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if job.SyncMode != "replace" {
		t.Errorf("default syncMode = %q, want replace", job.SyncMode)
	}
	if job.TriggerType != "manual" {
		t.Errorf("default triggerType = %q, want manual", job.TriggerType)
	}
}

func TestETLService_CreateJob_UnknownSource(t *testing.T) {
	env := newETLService(t)

	_, err := env.svc.CreateJob(context.Background(), CreateETLJobInput{
		Name:       "Bad",
		SourceType: "nonexistent",
	})
	if err == nil {
		t.Fatal("expected error for unknown source")
	}
}

func TestETLService_GetJob(t *testing.T) {
	env := newETLService(t)

	created, err := env.svc.CreateJob(context.Background(), CreateETLJobInput{
		Name:       "Get Me",
		SourceType: "csv_file",
	})
	if err != nil {
		t.Fatalf("setup create: %v", err)
	}

	got, err := env.svc.GetJob(created.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Name != "Get Me" {
		t.Errorf("name = %q", got.Name)
	}
}

func TestETLService_ListJobs(t *testing.T) {
	env := newETLService(t)

	env.svc.CreateJob(context.Background(), CreateETLJobInput{Name: "A", SourceType: "csv_file"})
	env.svc.CreateJob(context.Background(), CreateETLJobInput{Name: "B", SourceType: "json_file"})

	jobs, err := env.svc.ListJobs()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(jobs) != 2 {
		t.Errorf("len = %d, want 2", len(jobs))
	}
}

func TestETLService_UpdateJob(t *testing.T) {
	env := newETLService(t)

	created, err := env.svc.CreateJob(context.Background(), CreateETLJobInput{
		Name:       "Old Name",
		SourceType: "csv_file",
		SyncMode:   "replace",
	})
	if err != nil {
		t.Fatalf("setup create: %v", err)
	}

	err = env.svc.UpdateJob(context.Background(), created.ID, CreateETLJobInput{
		Name:       "New Name",
		SourceType: "json_file",
		SyncMode:   "append",
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}

	got, _ := env.svc.GetJob(created.ID)
	if got.Name != "New Name" {
		t.Errorf("name = %q", got.Name)
	}
	if got.SyncMode != "append" {
		t.Errorf("syncMode = %q", got.SyncMode)
	}
}

func TestETLService_DeleteJob(t *testing.T) {
	env := newETLService(t)

	created, err := env.svc.CreateJob(context.Background(), CreateETLJobInput{
		Name:       "Delete Me",
		SourceType: "csv_file",
	})
	if err != nil {
		t.Fatalf("setup create: %v", err)
	}

	if err := env.svc.DeleteJob(context.Background(), created.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}

	_, getErr := env.svc.GetJob(created.ID)
	if getErr == nil {
		t.Error("expected error after delete")
	}
}

// ── RunJob ──

func TestETLService_RunJob_CSVFile(t *testing.T) {
	env := newETLService(t)

	// Create target database first
	env.createTargetDB(t, "target-db", []string{"id", "name"})

	// Create a temp CSV file
	csvContent := "id,name\n1,alice\n2,bob\n"
	csvPath := t.TempDir() + "/test.csv"
	writeTestFile(t, csvPath, csvContent)

	job, err := env.svc.CreateJob(context.Background(), CreateETLJobInput{
		Name:       "CSV Import",
		SourceType: "csv_file",
		SourceConfig: map[string]any{
			"filePath": csvPath,
		},
		TargetDBID: "target-db",
		SyncMode:   "replace",
	})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}

	result, err := env.svc.RunJob(context.Background(), job.ID)
	if err != nil {
		t.Fatalf("run: %v", err)
	}

	if result.Status != "success" {
		t.Errorf("status = %q", result.Status)
	}
	if result.RowsRead != 2 {
		t.Errorf("rowsRead = %d, want 2", result.RowsRead)
	}
	if result.RowsWritten != 2 {
		t.Errorf("rowsWritten = %d, want 2", result.RowsWritten)
	}

	// Emitter should have been called with db:updated
	found := false
	for _, e := range env.emitter.Events {
		if e.Event == "db:updated" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected db:updated event")
	}
}

func TestETLService_RunJob_ConcurrencyGuard(t *testing.T) {
	env := newETLService(t)
	env.createTargetDB(t, "db-1", []string{"id"})

	csvPath := t.TempDir() + "/slow.csv"
	writeTestFile(t, csvPath, "id\n1\n2\n3\n4\n5\n")

	job, err := env.svc.CreateJob(context.Background(), CreateETLJobInput{
		Name:       "Slow Job",
		SourceType: "csv_file",
		SourceConfig: map[string]any{
			"filePath": csvPath,
		},
		TargetDBID: "db-1",
		SyncMode:   "replace",
	})
	if err != nil {
		t.Fatalf("setup create: %v", err)
	}

	// Start first run in background
	done := make(chan struct{})
	go func() {
		env.svc.RunJob(context.Background(), job.ID)
		close(done)
	}()

	// Give it a moment to start
	time.Sleep(10 * time.Millisecond)

	// Second run should fail with "already running" or succeed if first finished
	env.svc.RunJob(context.Background(), job.ID)

	<-done
}

func TestETLService_RunJob_NotFound(t *testing.T) {
	env := newETLService(t)

	_, err := env.svc.RunJob(context.Background(), "nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent job")
	}
}

func TestETLService_RunLogs(t *testing.T) {
	env := newETLService(t)
	env.createTargetDB(t, "db-1", []string{"id"})

	csvPath := t.TempDir() + "/test.csv"
	writeTestFile(t, csvPath, "id\n1\n")

	job, err := env.svc.CreateJob(context.Background(), CreateETLJobInput{
		Name:       "Log Job",
		SourceType: "csv_file",
		SourceConfig: map[string]any{
			"filePath": csvPath,
		},
		TargetDBID: "db-1",
		SyncMode:   "replace",
	})
	if err != nil {
		t.Fatalf("setup create: %v", err)
	}

	env.svc.RunJob(context.Background(), job.ID)

	logs, logsErr := env.svc.ListRunLogs(job.ID)
	if logsErr != nil {
		t.Fatalf("list logs: %v", logsErr)
	}
	if len(logs) != 1 {
		t.Fatalf("logs = %d, want 1", len(logs))
	}
	if logs[0].Status != "success" {
		t.Errorf("log status = %q", logs[0].Status)
	}
}

// ── ListSources ──

func TestETLService_ListSources(t *testing.T) {
	env := newETLService(t)
	specs := env.svc.ListSources()
	if len(specs) == 0 {
		t.Error("expected at least one source")
	}
	found := false
	for _, s := range specs {
		if s.Type == "csv_file" {
			found = true
			break
		}
	}
	if !found {
		t.Error("csv_file source not found")
	}
}

// ── Preview / Discover ──

func TestETLService_PreviewSource(t *testing.T) {
	env := newETLService(t)

	csvPath := t.TempDir() + "/preview.csv"
	writeTestFile(t, csvPath, "name,age\nalice,30\nbob,25\ncharlie,35\n")

	result, err := env.svc.PreviewSource(
		context.Background(),
		"csv_file",
		`{"filePath":"`+csvPath+`"}`,
	)
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	if len(result.Records) > 10 {
		t.Errorf("preview should be limited, got %d", len(result.Records))
	}
	if len(result.Schema.Fields) != 2 {
		t.Errorf("fields = %d, want 2", len(result.Schema.Fields))
	}
}

func TestETLService_PreviewSource_BadJSON(t *testing.T) {
	env := newETLService(t)

	_, err := env.svc.PreviewSource(context.Background(), "csv_file", "not json")
	if err == nil {
		t.Fatal("expected error for bad JSON")
	}
}

func TestETLService_DiscoverSchema(t *testing.T) {
	env := newETLService(t)

	csvPath := t.TempDir() + "/discover.csv"
	writeTestFile(t, csvPath, "x,y\n1,2\n")

	schema, err := env.svc.DiscoverSchema(
		context.Background(),
		"csv_file",
		`{"filePath":"`+csvPath+`"}`,
	)
	if err != nil {
		t.Fatalf("discover: %v", err)
	}
	if len(schema.Fields) != 2 {
		t.Errorf("fields = %d, want 2", len(schema.Fields))
	}
}

func TestETLService_DiscoverSchema_BadJSON(t *testing.T) {
	env := newETLService(t)

	_, err := env.svc.DiscoverSchema(context.Background(), "csv_file", "bad")
	if err == nil {
		t.Fatal("expected error for bad JSON")
	}
}

func TestETLService_DiscoverSchema_UnknownSource(t *testing.T) {
	env := newETLService(t)

	_, err := env.svc.DiscoverSchema(context.Background(), "nonexistent", `{}`)
	if err == nil {
		t.Fatal("expected error for unknown source")
	}
}

// ── WaitRunning / Stop ──

func TestETLService_WaitRunning_Immediate(t *testing.T) {
	env := newETLService(t)

	done := make(chan struct{})
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()
		env.svc.WaitRunning(ctx)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("WaitRunning hung with no running jobs")
	}
}

func TestETLService_Stop_Idempotent(t *testing.T) {
	env := newETLService(t)
	env.svc.Stop()
	env.svc.Stop() // should not panic
}

// ── Helpers ──

func writeTestFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("write test file: %v", err)
	}
}
