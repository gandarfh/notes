package storage

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"notes/internal/etl"

	"github.com/google/uuid"
)

// ETLStore implements persistence for ETL sync jobs and run logs.
type ETLStore struct {
	db *DB
}

// NewETLStore creates a new ETLStore.
func NewETLStore(db *DB) *ETLStore {
	return &ETLStore{db: db}
}

// ── SyncJob CRUD ───────────────────────────────────────────

func (s *ETLStore) CreateJob(job *etl.SyncJob) error {
	now := time.Now()
	job.ID = uuid.New().String()
	job.CreatedAt = now
	job.UpdatedAt = now

	srcCfg, _ := json.Marshal(job.SourceCfg)
	transforms, _ := json.Marshal(job.Transforms)

	_, err := s.db.conn.Exec(
		`INSERT INTO etl_jobs (id, name, source_type, source_config, transforms, target_db_id,
		 sync_mode, dedupe_key, trigger_type, trigger_config, enabled, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		job.ID, job.Name, job.SourceType, string(srcCfg), string(transforms),
		job.TargetDBID, job.SyncMode, job.DedupeKey,
		job.TriggerType, job.TriggerConfig, job.Enabled,
		job.CreatedAt, job.UpdatedAt,
	)
	return err
}

func (s *ETLStore) GetJob(id string) (*etl.SyncJob, error) {
	job := &etl.SyncJob{}
	var srcCfg, transforms string

	err := s.db.conn.QueryRow(
		`SELECT id, name, source_type, source_config, transforms, target_db_id,
		 sync_mode, dedupe_key, trigger_type, trigger_config, enabled,
		 last_run_at, last_status, last_error, created_at, updated_at
		 FROM etl_jobs WHERE id = ?`, id,
	).Scan(
		&job.ID, &job.Name, &job.SourceType, &srcCfg, &transforms,
		&job.TargetDBID, &job.SyncMode, &job.DedupeKey,
		&job.TriggerType, &job.TriggerConfig, &job.Enabled,
		&job.LastRunAt, &job.LastStatus, &job.LastError,
		&job.CreatedAt, &job.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("etl job not found: %s", id)
	}
	if err != nil {
		return nil, err
	}

	json.Unmarshal([]byte(srcCfg), &job.SourceCfg)
	json.Unmarshal([]byte(transforms), &job.Transforms)
	return job, nil
}

func (s *ETLStore) UpdateJob(job *etl.SyncJob) error {
	job.UpdatedAt = time.Now()
	srcCfg, _ := json.Marshal(job.SourceCfg)
	transforms, _ := json.Marshal(job.Transforms)

	_, err := s.db.conn.Exec(
		`UPDATE etl_jobs SET name=?, source_type=?, source_config=?, transforms=?,
		 target_db_id=?, sync_mode=?, dedupe_key=?, trigger_type=?, trigger_config=?,
		 enabled=?, updated_at=? WHERE id=?`,
		job.Name, job.SourceType, string(srcCfg), string(transforms),
		job.TargetDBID, job.SyncMode, job.DedupeKey,
		job.TriggerType, job.TriggerConfig, job.Enabled,
		job.UpdatedAt, job.ID,
	)
	return err
}

func (s *ETLStore) UpdateJobStatus(id, status, errMsg string) error {
	_, err := s.db.conn.Exec(
		`UPDATE etl_jobs SET last_run_at=?, last_status=?, last_error=?, updated_at=? WHERE id=?`,
		time.Now(), status, errMsg, time.Now(), id,
	)
	return err
}

func (s *ETLStore) DeleteJob(id string) error {
	// Delete run logs first.
	if _, err := s.db.conn.Exec(`DELETE FROM etl_run_logs WHERE job_id = ?`, id); err != nil {
		return err
	}
	_, err := s.db.conn.Exec(`DELETE FROM etl_jobs WHERE id = ?`, id)
	return err
}

func (s *ETLStore) ListJobs() ([]etl.SyncJob, error) {
	rows, err := s.db.conn.Query(
		`SELECT id, name, source_type, source_config, transforms, target_db_id,
		 sync_mode, dedupe_key, trigger_type, trigger_config, enabled,
		 last_run_at, last_status, last_error, created_at, updated_at
		 FROM etl_jobs ORDER BY created_at ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var jobs []etl.SyncJob
	for rows.Next() {
		var job etl.SyncJob
		var srcCfg, transforms string
		if err := rows.Scan(
			&job.ID, &job.Name, &job.SourceType, &srcCfg, &transforms,
			&job.TargetDBID, &job.SyncMode, &job.DedupeKey,
			&job.TriggerType, &job.TriggerConfig, &job.Enabled,
			&job.LastRunAt, &job.LastStatus, &job.LastError,
			&job.CreatedAt, &job.UpdatedAt,
		); err != nil {
			return nil, err
		}
		json.Unmarshal([]byte(srcCfg), &job.SourceCfg)
		json.Unmarshal([]byte(transforms), &job.Transforms)
		jobs = append(jobs, job)
	}
	return jobs, rows.Err()
}

// ListEnabledScheduledJobs returns jobs that are enabled with a schedule trigger.
func (s *ETLStore) ListEnabledScheduledJobs() ([]etl.SyncJob, error) {
	rows, err := s.db.conn.Query(
		`SELECT id, name, source_type, source_config, transforms, target_db_id,
		 sync_mode, dedupe_key, trigger_type, trigger_config, enabled,
		 last_run_at, last_status, last_error, created_at, updated_at
		 FROM etl_jobs WHERE enabled = 1 AND trigger_type IN ('schedule', 'file_watch')
		 ORDER BY created_at ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var jobs []etl.SyncJob
	for rows.Next() {
		var job etl.SyncJob
		var srcCfg, transforms string
		if err := rows.Scan(
			&job.ID, &job.Name, &job.SourceType, &srcCfg, &transforms,
			&job.TargetDBID, &job.SyncMode, &job.DedupeKey,
			&job.TriggerType, &job.TriggerConfig, &job.Enabled,
			&job.LastRunAt, &job.LastStatus, &job.LastError,
			&job.CreatedAt, &job.UpdatedAt,
		); err != nil {
			return nil, err
		}
		json.Unmarshal([]byte(srcCfg), &job.SourceCfg)
		json.Unmarshal([]byte(transforms), &job.Transforms)
		jobs = append(jobs, job)
	}
	return jobs, rows.Err()
}

// ── Run Logs ───────────────────────────────────────────────

func (s *ETLStore) CreateRunLog(log *etl.SyncRunLog) error {
	log.ID = uuid.New().String()
	_, err := s.db.conn.Exec(
		`INSERT INTO etl_run_logs (id, job_id, started_at, finished_at, status, rows_read, rows_written, error)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		log.ID, log.JobID, log.StartedAt, log.FinishedAt, log.Status, log.RowsRead, log.RowsWritten, log.Error,
	)
	return err
}

func (s *ETLStore) ListRunLogs(jobID string, limit int) ([]etl.SyncRunLog, error) {
	rows, err := s.db.conn.Query(
		`SELECT id, job_id, started_at, finished_at, status, rows_read, rows_written, error
		 FROM etl_run_logs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?`,
		jobID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []etl.SyncRunLog
	for rows.Next() {
		var l etl.SyncRunLog
		if err := rows.Scan(&l.ID, &l.JobID, &l.StartedAt, &l.FinishedAt, &l.Status, &l.RowsRead, &l.RowsWritten, &l.Error); err != nil {
			return nil, err
		}
		logs = append(logs, l)
	}
	return logs, rows.Err()
}
