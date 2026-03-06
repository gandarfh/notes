package service

import (
	"context"
	"testing"
	"time"
)

// ─────────────────────────────────────────────────────────────
// RunningJobsGuard tests
// ─────────────────────────────────────────────────────────────

func TestRunningGuard_TryLock(t *testing.T) {
	var g ExportedRunningGuard

	if !g.TryLock("job-1") {
		t.Fatal("expected first TryLock to succeed")
	}
	if g.TryLock("job-1") {
		t.Fatal("expected second TryLock for same job to fail")
	}
	if !g.TryLock("job-2") {
		t.Fatal("expected TryLock for different job to succeed")
	}
	g.Unlock("job-1")
	g.Unlock("job-2")

	if !g.TryLock("job-1") {
		t.Fatal("expected TryLock to succeed after unlock")
	}
	g.Unlock("job-1")
}

func TestRunningGuard_WaitAll(t *testing.T) {
	var g ExportedRunningGuard

	if !g.TryLock("job-a") {
		t.Fatal("expected lock to succeed")
	}

	done := make(chan struct{})
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		defer cancel()
		g.WaitAll(ctx)
		close(done)
	}()

	go func() {
		time.Sleep(20 * time.Millisecond)
		g.Unlock("job-a")
	}()

	select {
	case <-done:
		// success
	case <-time.After(1 * time.Second):
		t.Fatal("WaitAll timed out")
	}
}

func TestRunningGuard_WaitAll_NoJobs(t *testing.T) {
	var g ExportedRunningGuard

	done := make(chan struct{})
	go func() {
		g.WaitAll(context.Background())
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(100 * time.Millisecond):
		t.Fatal("WaitAll should return immediately with no jobs")
	}
}

func TestRunningGuard_WaitAll_ContextCancellation(t *testing.T) {
	var g ExportedRunningGuard

	g.TryLock("job-1")

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	done := make(chan struct{})
	go func() {
		g.WaitAll(ctx)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("WaitAll should respect context cancellation")
	}

	g.Unlock("job-1")
}

// ─────────────────────────────────────────────────────────────
// MockEmitter tests
// ─────────────────────────────────────────────────────────────

func TestMockEmitter_RecordsEvents(t *testing.T) {
	m := &MockEmitter{}
	ctx := context.Background()

	m.Emit(ctx, "test:event", map[string]string{"foo": "bar"})
	m.Emit(ctx, "test:event2", nil)

	if len(m.Events) != 2 {
		t.Fatalf("expected 2 events, got %d", len(m.Events))
	}
	if m.Events[0].Event != "test:event" {
		t.Errorf("expected 'test:event', got %q", m.Events[0].Event)
	}
}

func TestMockEmitter_LastEvent(t *testing.T) {
	m := &MockEmitter{}
	ctx := context.Background()

	m.Emit(ctx, "a", "first")
	m.Emit(ctx, "b", "second")

	if m.Events[len(m.Events)-1].Event != "b" {
		t.Errorf("expected last event 'b', got %q", m.Events[len(m.Events)-1].Event)
	}
}
