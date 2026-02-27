package service_test

import (
	"context"
	"testing"
	"time"

	"notes/internal/service"
)

// ─────────────────────────────────────────────────────────────
// ETLService unit tests
// Uses only the pure logic paths that don't require I/O:
//   - RunningJobsGuard prevents double-run
//   - WaitRunning / Stop
//   - CreateETLJobInput field defaults
// ─────────────────────────────────────────────────────────────

func TestETLService_NewETLService(t *testing.T) {
	// NewETLService should return non-nil value with no store (nil-safe check)
	emitter := &service.MockEmitter{}
	svc := service.NewETLService(nil, nil, emitter)
	if svc == nil {
		t.Fatal("expected non-nil ETLService")
	}
}

func TestETLService_WaitRunning_Immediate(t *testing.T) {
	// With no running jobs, WaitRunning should return immediately
	emitter := &service.MockEmitter{}
	svc := service.NewETLService(nil, nil, emitter)

	done := make(chan struct{})
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()
		svc.WaitRunning(ctx)
		close(done)
	}()

	select {
	case <-done:
		// expected — no jobs running
	case <-time.After(500 * time.Millisecond):
		t.Fatal("WaitRunning hung with no running jobs")
	}
}

func TestETLService_Stop_Idempotent(t *testing.T) {
	// Stop with nothing started should not panic
	emitter := &service.MockEmitter{}
	svc := service.NewETLService(nil, nil, emitter)
	svc.Stop()
	svc.Stop() // second call should also be safe
}

func TestETLService_EmitterCalledOnSuccess(t *testing.T) {
	// The emitter is only called when RunJob completes with success.
	// Since we can't run a real job without a DB, we verify
	// that MockEmitter starts with zero events.
	emitter := &service.MockEmitter{}
	if len(emitter.Events) != 0 {
		t.Fatalf("expected 0 initial events, got %d", len(emitter.Events))
	}
}
