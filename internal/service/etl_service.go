package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"path/filepath"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/robfig/cron/v3"

	"notes/internal/etl"
	"notes/internal/etl/sources"
	"notes/internal/storage"
)

// ─────────────────────────────────────────────────────────────
// ETL Service — business logic for ETL sync jobs
// ─────────────────────────────────────────────────────────────

// ETLService manages ETL sync jobs, scheduling, and file watching.
// It is decoupled from the Wails App struct via the EventEmitter interface.
type ETLService struct {
	store       *storage.ETLStore
	localDB     *storage.LocalDatabaseStore
	emitter     EventEmitter
	runningJobs runningJobsGuard

	// watcher / cron lifecycle
	watchCancel context.CancelFunc
	watcher     *fsnotify.Watcher
	cronSched   *cron.Cron
}

// NewETLService creates an ETLService ready for use.
func NewETLService(
	store *storage.ETLStore,
	localDB *storage.LocalDatabaseStore,
	emitter EventEmitter,
) *ETLService {
	return &ETLService{
		store:   store,
		localDB: localDB,
		emitter: emitter,
	}
}

// ── Job CRUD ───────────────────────────────────────────────

type CreateETLJobInput struct {
	Name          string                `json:"name"`
	SourceType    string                `json:"sourceType"`
	SourceConfig  map[string]any        `json:"sourceConfig"`
	Transforms    []etl.TransformConfig `json:"transforms"`
	TargetDBID    string                `json:"targetDbId"`
	SyncMode      string                `json:"syncMode"`
	DedupeKey     string                `json:"dedupeKey"`
	TriggerType   string                `json:"triggerType"`
	TriggerConfig string                `json:"triggerConfig"`
	Enabled       bool                  `json:"enabled"`
}

func (s *ETLService) CreateJob(ctx context.Context, input CreateETLJobInput) (*etl.SyncJob, error) {
	if _, err := etl.GetSource(input.SourceType); err != nil {
		return nil, err
	}

	job := &etl.SyncJob{
		Name:          input.Name,
		SourceType:    input.SourceType,
		SourceCfg:     input.SourceConfig,
		Transforms:    input.Transforms,
		TargetDBID:    input.TargetDBID,
		SyncMode:      etl.SyncMode(input.SyncMode),
		DedupeKey:     input.DedupeKey,
		TriggerType:   input.TriggerType,
		TriggerConfig: input.TriggerConfig,
		Enabled:       input.Enabled,
	}
	if job.SyncMode == "" {
		job.SyncMode = etl.SyncReplace
	}
	if job.TriggerType == "" {
		job.TriggerType = "manual"
	}

	if err := s.store.CreateJob(job); err != nil {
		return nil, fmt.Errorf("create etl job: %w", err)
	}
	s.RestartWatchers(ctx)
	return job, nil
}

func (s *ETLService) GetJob(id string) (*etl.SyncJob, error) {
	return s.store.GetJob(id)
}

func (s *ETLService) ListJobs() ([]etl.SyncJob, error) {
	return s.store.ListJobs()
}

func (s *ETLService) UpdateJob(ctx context.Context, id string, input CreateETLJobInput) error {
	job, err := s.store.GetJob(id)
	if err != nil {
		return err
	}
	job.Name = input.Name
	job.SourceType = input.SourceType
	job.SourceCfg = input.SourceConfig
	job.Transforms = input.Transforms
	job.TargetDBID = input.TargetDBID
	job.SyncMode = etl.SyncMode(input.SyncMode)
	job.DedupeKey = input.DedupeKey
	job.TriggerType = input.TriggerType
	job.TriggerConfig = input.TriggerConfig

	if err := s.store.UpdateJob(job); err != nil {
		return err
	}
	s.RestartWatchers(ctx)
	return nil
}

func (s *ETLService) DeleteJob(ctx context.Context, id string) error {
	err := s.store.DeleteJob(id)
	if err == nil {
		s.RestartWatchers(ctx)
	}
	return err
}

// ── Run ────────────────────────────────────────────────────

// RunJob executes a single ETL sync job synchronously and emits frontend events on success.
func (s *ETLService) RunJob(ctx context.Context, id string) (*etl.SyncResult, error) {
	// Prevent concurrent execution of the same job.
	if !s.runningJobs.TryLock(id) {
		return nil, fmt.Errorf("job %s is already running", id)
	}
	defer s.runningJobs.Unlock(id)

	job, err := s.store.GetJob(id)
	if err != nil {
		return nil, err
	}

	s.store.UpdateJobStatus(id, "running", "")

	engine := &etl.Engine{
		Dest: &etl.LocalDBWriter{Store: s.localDB},
	}

	runCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	start := time.Now()
	result, runErr := engine.RunSync(runCtx, job)

	runLog := &etl.SyncRunLog{
		JobID:       id,
		StartedAt:   start,
		FinishedAt:  time.Now(),
		Status:      result.Status,
		RowsRead:    result.RowsRead,
		RowsWritten: result.RowsWritten,
	}
	if runErr != nil {
		runLog.Error = runErr.Error()
	}
	s.store.CreateRunLog(runLog)

	errMsg := ""
	if runErr != nil {
		errMsg = runErr.Error()
	}
	s.store.UpdateJobStatus(id, result.Status, errMsg)

	// Notify frontend on success.
	if result.Status == "success" && job.TargetDBID != "" {
		s.emitter.Emit(ctx, "db:updated", map[string]string{
			"databaseId": job.TargetDBID,
			"jobId":      id,
		})
	}

	return result, runErr
}

// ListSources returns the available ETL source descriptors.
func (s *ETLService) ListSources() []etl.SourceSpec {
	return etl.ListSources()
}

// ListRunLogs returns the last 50 run logs for a job.
func (s *ETLService) ListRunLogs(jobID string) ([]etl.SyncRunLog, error) {
	return s.store.ListRunLogs(jobID, 50)
}

// ── Preview / Schema Discovery ─────────────────────────────

func (s *ETLService) PreviewSource(ctx context.Context, sourceType string, cfgJSON string) (*PreviewResult, error) {
	var cfg etl.SourceConfig
	if err := json.Unmarshal([]byte(cfgJSON), &cfg); err != nil {
		return nil, fmt.Errorf("parse source config: %w", err)
	}

	engine := &etl.Engine{
		Dest: &etl.LocalDBWriter{Store: s.localDB},
	}

	previewCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	records, schema, err := engine.Preview(previewCtx, sourceType, cfg, 10)
	if err != nil {
		return nil, err
	}
	return &PreviewResult{Schema: schema, Records: records}, nil
}

// PreviewResult is the response from PreviewSource.
type PreviewResult struct {
	Schema  *etl.Schema  `json:"schema"`
	Records []etl.Record `json:"records"`
}

func (s *ETLService) DiscoverSchema(ctx context.Context, sourceType string, cfgJSON string) (*etl.Schema, error) {
	var cfg etl.SourceConfig
	if err := json.Unmarshal([]byte(cfgJSON), &cfg); err != nil {
		return nil, fmt.Errorf("parse source config: %w", err)
	}

	source, err := etl.GetSource(sourceType)
	if err != nil {
		return nil, err
	}

	discCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	return source.Discover(discCtx, cfg)
}

// ── Watchers (cron + file_watch) ──────────────────────────

// RestartWatchers tears down the current watcher/cron and rebuilds them from scratch.
func (s *ETLService) RestartWatchers(ctx context.Context) {
	s.stopWatchers()

	jobs, err := s.store.ListEnabledScheduledJobs()
	if err != nil {
		log.Printf("etl watcher: failed to list jobs: %v", err)
		return
	}

	// ── Cron jobs ──
	var cronJobs []struct {
		jobID string
		expr  string
	}
	for _, j := range jobs {
		if j.TriggerType == "schedule" && j.TriggerConfig != "" {
			cronJobs = append(cronJobs, struct {
				jobID string
				expr  string
			}{jobID: j.ID, expr: j.TriggerConfig})
		}
	}

	if len(cronJobs) > 0 {
		c := cron.New()
		for _, cj := range cronJobs {
			jid := cj.jobID
			_, err := c.AddFunc(cj.expr, func() {
				log.Printf("etl cron: running job %s", jid)
				if _, err := s.RunJob(ctx, jid); err != nil {
					log.Printf("etl cron: job %s failed: %v", jid, err)
				}
				s.emitter.Emit(ctx, "etl:job-completed", jid)
			})
			if err != nil {
				log.Printf("etl cron: invalid expression %q for job %s: %v", cj.expr, cj.jobID, err)
			}
		}
		c.Start()
		s.cronSched = c
		log.Printf("etl cron: scheduled %d job(s)", len(cronJobs))
	}

	// ── File watchers ──
	type watchEntry struct {
		jobID string
		path  string
	}
	var entries []watchEntry
	for _, j := range jobs {
		if j.TriggerType == "file_watch" && j.TriggerConfig != "" {
			entries = append(entries, watchEntry{jobID: j.ID, path: j.TriggerConfig})
		}
	}

	if len(entries) == 0 {
		return
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Printf("etl watcher: failed to create watcher: %v", err)
		return
	}
	s.watcher = watcher

	pathToJob := make(map[string]string)
	watchedDirs := make(map[string]bool)
	for _, e := range entries {
		absPath, err := filepath.Abs(e.path)
		if err != nil {
			log.Printf("etl watcher: bad path %q: %v", e.path, err)
			continue
		}
		pathToJob[absPath] = e.jobID

		dir := filepath.Dir(absPath)
		if !watchedDirs[dir] {
			if err := watcher.Add(dir); err != nil {
				log.Printf("etl watcher: failed to watch dir %q: %v", dir, err)
			} else {
				watchedDirs[dir] = true
			}
		}
	}

	watchCtx, cancel := context.WithCancel(context.Background())
	s.watchCancel = cancel

	go func() {
		timers := make(map[string]*time.Timer)
		for {
			select {
			case <-watchCtx.Done():
				return
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				if !event.Has(fsnotify.Write) && !event.Has(fsnotify.Create) {
					continue
				}
				absPath, _ := filepath.Abs(event.Name)
				jobID, ok := pathToJob[absPath]
				if !ok {
					continue
				}
				if t, exists := timers[jobID]; exists {
					t.Stop()
				}
				jid := jobID
				timers[jobID] = time.AfterFunc(500*time.Millisecond, func() {
					log.Printf("etl watcher: file changed %q, running job %s", absPath, jid)
					if _, err := s.RunJob(ctx, jid); err != nil {
						log.Printf("etl watcher: run failed for job %s: %v", jid, err)
					}
				})
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				log.Printf("etl watcher: error: %v", err)
			}
		}
	}()

	log.Printf("etl watcher: watching %d file(s)", len(pathToJob))
}

// WaitRunning blocks until all running jobs finish or ctx is cancelled.
// Used for graceful shutdown.
func (s *ETLService) WaitRunning(ctx context.Context) {
	s.runningJobs.WaitAll(ctx)
}

// Stop tears down all watchers and schedulers.
func (s *ETLService) Stop() {
	s.stopWatchers()
}

func (s *ETLService) stopWatchers() {
	if s.watchCancel != nil {
		s.watchCancel()
		s.watchCancel = nil
	}
	if s.watcher != nil {
		s.watcher.Close()
		s.watcher = nil
	}
	if s.cronSched != nil {
		s.cronSched.Stop()
		s.cronSched = nil
	}
}

// ── BlockResolver / DBProvider adapters ───────────────────
// Used by ETL sources to resolve block references.

// BlockResolver adapts the ETL source to resolve a block's DB connection + query.
type BlockResolver interface {
	GetBlockContent(ctx context.Context, blockID string) (connectionID, query string, err error)
}

// DBProvider adapts the ETL source to execute queries.
type DBProvider interface {
	ExecuteETLQuery(ctx context.Context, connID, query string, fetchSize int) (*sources.QueryPage, error)
	FetchMoreETLRows(ctx context.Context, connID string, fetchSize int) (*sources.QueryPage, error)
}

// HTTPBlockResolver adapts the ETL source to resolve an HTTP block's config.
type HTTPBlockResolver interface {
	GetHTTPBlockContent(blockID string) (url, method, headersJSON, bodyJSON string, err error)
}
