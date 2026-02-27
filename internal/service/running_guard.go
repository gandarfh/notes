package service

import (
	"context"
	"sync"
)

// ExportedRunningGuard is an exported alias so _test packages can test the guard.
type ExportedRunningGuard = runningJobsGuard

// ─────────────────────────────────────────────────────────────
// runningJobsGuard — prevents concurrent execution of the same job
// ─────────────────────────────────────────────────────────────

// runningJobsGuard is a concurrency guard that ensures only one
// instance of a given job ID runs at a time.
type runningJobsGuard struct {
	mu      sync.Mutex
	running map[string]struct{}
	wg      sync.WaitGroup
}

// TryLock attempts to mark jobID as running. Returns true if successful.
// Returns false if the job is already running.
func (g *runningJobsGuard) TryLock(jobID string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.running == nil {
		g.running = make(map[string]struct{})
	}
	if _, ok := g.running[jobID]; ok {
		return false // already running
	}
	g.running[jobID] = struct{}{}
	g.wg.Add(1)
	return true
}

// Unlock marks the job as no longer running. Must be called after TryLock returns true.
func (g *runningJobsGuard) Unlock(jobID string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.running, jobID)
	g.wg.Done()
}

// WaitAll blocks until all currently running jobs complete or ctx is cancelled.
func (g *runningJobsGuard) WaitAll(ctx context.Context) {
	done := make(chan struct{})
	go func() {
		g.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-ctx.Done():
	}
}
