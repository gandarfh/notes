package service_test

import (
	"context"
	"testing"
	"time"

	"notes/internal/service"
)

// ─────────────────────────────────────────────────────────────
// RunningJobsGuard tests
// ─────────────────────────────────────────────────────────────

func TestRunningGuard_TryLock(t *testing.T) {
	var g service.ExportedRunningGuard

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
	var g service.ExportedRunningGuard

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

// ─────────────────────────────────────────────────────────────
// MockEmitter tests
// ─────────────────────────────────────────────────────────────

func TestMockEmitter_RecordsEvents(t *testing.T) {
	m := &service.MockEmitter{}
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
	m := &service.MockEmitter{}
	ctx := context.Background()

	m.Emit(ctx, "a", "first")
	m.Emit(ctx, "b", "second")

	if m.Events[len(m.Events)-1].Event != "b" {
		t.Errorf("expected last event 'b', got %q", m.Events[len(m.Events)-1].Event)
	}
}
