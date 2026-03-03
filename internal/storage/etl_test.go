package storage

import (
	"testing"
	"time"

	"notes/internal/etl"
)

func newETLStore(t *testing.T) *ETLStore {
	t.Helper()
	return NewETLStore(newTestDB(t))
}

// ── Job Tests ───────────────────────────────────────────────

func TestETLStore_CreateAndGetJob(t *testing.T) {
	s := newETLStore(t)

	job := &etl.SyncJob{
		Name:       "CSV Import",
		SourceType: "csv",
		SourceCfg:  map[string]any{"path": "/tmp/data.csv"},
		Transforms: []etl.TransformConfig{
			{Type: "filter", Config: map[string]any{"field": "status", "op": "eq", "value": "active"}},
		},
		TargetDBID:    "db-1",
		SyncMode:      "replace",
		TriggerType:   "manual",
		TriggerConfig: "",
		Enabled:       true,
	}
	if err := s.CreateJob(job); err != nil {
		t.Fatalf("create: %v", err)
	}

	if job.ID == "" {
		t.Error("ID should be auto-generated")
	}
	if job.CreatedAt.IsZero() {
		t.Error("CreatedAt not set")
	}

	got, err := s.GetJob(job.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Name != "CSV Import" {
		t.Errorf("name = %q", got.Name)
	}
	if got.SourceType != "csv" {
		t.Errorf("sourceType = %q", got.SourceType)
	}
	// JSON roundtrip for SourceCfg
	if got.SourceCfg["path"] != "/tmp/data.csv" {
		t.Errorf("sourceCfg.path = %v", got.SourceCfg["path"])
	}
	// JSON roundtrip for Transforms
	if len(got.Transforms) != 1 {
		t.Fatalf("transforms len = %d, want 1", len(got.Transforms))
	}
	if got.Transforms[0].Type != "filter" {
		t.Errorf("transforms[0].type = %q", got.Transforms[0].Type)
	}
	if got.SyncMode != "replace" {
		t.Errorf("syncMode = %q", got.SyncMode)
	}
	if !got.Enabled {
		t.Error("enabled should be true")
	}
}

func TestETLStore_GetJob_NotFound(t *testing.T) {
	s := newETLStore(t)
	_, err := s.GetJob("nonexistent")
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestETLStore_UpdateJob(t *testing.T) {
	s := newETLStore(t)

	job := &etl.SyncJob{Name: "Old", SourceType: "csv", SourceCfg: map[string]any{}, Enabled: true}
	s.CreateJob(job)

	job.Name = "New"
	job.SyncMode = "append"
	job.Enabled = false
	if err := s.UpdateJob(job); err != nil {
		t.Fatalf("update: %v", err)
	}

	got, _ := s.GetJob(job.ID)
	if got.Name != "New" {
		t.Errorf("name = %q", got.Name)
	}
	if got.SyncMode != "append" {
		t.Errorf("syncMode = %q", got.SyncMode)
	}
	if got.Enabled {
		t.Error("enabled should be false")
	}
}

func TestETLStore_UpdateJobStatus(t *testing.T) {
	s := newETLStore(t)

	job := &etl.SyncJob{Name: "Test", SourceType: "csv", SourceCfg: map[string]any{}}
	s.CreateJob(job)

	if err := s.UpdateJobStatus(job.ID, "success", ""); err != nil {
		t.Fatalf("update status: %v", err)
	}

	got, _ := s.GetJob(job.ID)
	if got.LastStatus != "success" {
		t.Errorf("lastStatus = %q", got.LastStatus)
	}
	if got.LastRunAt.IsZero() {
		t.Error("lastRunAt should be set")
	}
}

func TestETLStore_UpdateJobStatus_WithError(t *testing.T) {
	s := newETLStore(t)

	job := &etl.SyncJob{Name: "Test", SourceType: "csv", SourceCfg: map[string]any{}}
	s.CreateJob(job)

	if err := s.UpdateJobStatus(job.ID, "error", "connection refused"); err != nil {
		t.Fatalf("update status: %v", err)
	}

	got, _ := s.GetJob(job.ID)
	if got.LastStatus != "error" {
		t.Errorf("lastStatus = %q", got.LastStatus)
	}
	if got.LastError != "connection refused" {
		t.Errorf("lastError = %q", got.LastError)
	}
}

func TestETLStore_DeleteJob_CascadesRunLogs(t *testing.T) {
	s := newETLStore(t)

	job := &etl.SyncJob{Name: "Test", SourceType: "csv", SourceCfg: map[string]any{}}
	s.CreateJob(job)

	// Add run logs
	log := &etl.SyncRunLog{
		JobID:      job.ID,
		StartedAt:  time.Now(),
		FinishedAt: time.Now(),
		Status:     "success",
		RowsRead:   10,
	}
	s.CreateRunLog(log)

	if err := s.DeleteJob(job.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}

	_, err := s.GetJob(job.ID)
	if err == nil {
		t.Fatal("job should be deleted")
	}

	logs, _ := s.ListRunLogs(job.ID, 50)
	if len(logs) != 0 {
		t.Errorf("run logs len = %d, want 0 (cascade delete)", len(logs))
	}
}

func TestETLStore_ListJobs(t *testing.T) {
	s := newETLStore(t)

	for _, name := range []string{"Job A", "Job B"} {
		job := &etl.SyncJob{Name: name, SourceType: "csv", SourceCfg: map[string]any{}}
		s.CreateJob(job)
	}

	list, err := s.ListJobs()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("len = %d, want 2", len(list))
	}
}

func TestETLStore_ListJobs_Empty(t *testing.T) {
	s := newETLStore(t)
	list, err := s.ListJobs()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if list != nil {
		t.Errorf("expected nil, got %v", list)
	}
}

func TestETLStore_ListEnabledScheduledJobs(t *testing.T) {
	s := newETLStore(t)

	jobs := []struct {
		name    string
		trigger string
		enabled bool
	}{
		{"Manual", "manual", true},
		{"Scheduled Active", "schedule", true},
		{"Scheduled Disabled", "schedule", false},
		{"FileWatch Active", "file_watch", true},
	}

	for _, j := range jobs {
		job := &etl.SyncJob{
			Name: j.name, SourceType: "csv", SourceCfg: map[string]any{},
			TriggerType: j.trigger, Enabled: j.enabled,
		}
		s.CreateJob(job)
	}

	list, err := s.ListEnabledScheduledJobs()
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	// Should only return: Scheduled Active, FileWatch Active
	if len(list) != 2 {
		t.Fatalf("len = %d, want 2", len(list))
	}
	for _, j := range list {
		if !j.Enabled {
			t.Errorf("job %q is disabled", j.Name)
		}
		if j.TriggerType != "schedule" && j.TriggerType != "file_watch" {
			t.Errorf("job %q has trigger %q", j.Name, j.TriggerType)
		}
	}
}

// ── RunLog Tests ────────────────────────────────────────────

func TestETLStore_CreateAndListRunLogs(t *testing.T) {
	s := newETLStore(t)

	job := &etl.SyncJob{Name: "Test", SourceType: "csv", SourceCfg: map[string]any{}}
	s.CreateJob(job)

	now := time.Now()
	for i := 0; i < 3; i++ {
		log := &etl.SyncRunLog{
			JobID:       job.ID,
			StartedAt:   now.Add(time.Duration(i) * time.Minute),
			FinishedAt:  now.Add(time.Duration(i)*time.Minute + 30*time.Second),
			Status:      "success",
			RowsRead:    10 * (i + 1),
			RowsWritten: 10 * (i + 1),
		}
		if err := s.CreateRunLog(log); err != nil {
			t.Fatalf("create log %d: %v", i, err)
		}
		if log.ID == "" {
			t.Error("log ID should be auto-generated")
		}
	}

	logs, err := s.ListRunLogs(job.ID, 50)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(logs) != 3 {
		t.Fatalf("len = %d, want 3", len(logs))
	}

	// Should be ordered by started_at DESC (newest first)
	if logs[0].RowsRead < logs[2].RowsRead {
		t.Error("logs should be ordered by started_at DESC")
	}
}

func TestETLStore_ListRunLogs_Limit(t *testing.T) {
	s := newETLStore(t)

	job := &etl.SyncJob{Name: "Test", SourceType: "csv", SourceCfg: map[string]any{}}
	s.CreateJob(job)

	now := time.Now()
	for i := 0; i < 5; i++ {
		log := &etl.SyncRunLog{
			JobID:      job.ID,
			StartedAt:  now.Add(time.Duration(i) * time.Minute),
			FinishedAt: now.Add(time.Duration(i)*time.Minute + 10*time.Second),
			Status:     "success",
		}
		s.CreateRunLog(log)
	}

	logs, _ := s.ListRunLogs(job.ID, 2)
	if len(logs) != 2 {
		t.Errorf("len = %d, want 2 (limited)", len(logs))
	}
}

func TestETLStore_RunLog_WithError(t *testing.T) {
	s := newETLStore(t)

	job := &etl.SyncJob{Name: "Test", SourceType: "csv", SourceCfg: map[string]any{}}
	s.CreateJob(job)

	log := &etl.SyncRunLog{
		JobID:      job.ID,
		StartedAt:  time.Now(),
		FinishedAt: time.Now(),
		Status:     "error",
		Error:      "file not found",
	}
	s.CreateRunLog(log)

	logs, _ := s.ListRunLogs(job.ID, 10)
	if logs[0].Status != "error" {
		t.Errorf("status = %q, want error", logs[0].Status)
	}
	if logs[0].Error != "file not found" {
		t.Errorf("error = %q", logs[0].Error)
	}
}
