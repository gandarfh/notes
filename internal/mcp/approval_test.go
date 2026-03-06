package mcpserver

import (
	"context"
	"sync"
	"testing"
	"time"
)

// mockEmitter captures events for test assertions.
type mockEmitter struct {
	mu     sync.Mutex
	events []emittedEvent
}

type emittedEvent struct {
	event string
	data  any
}

func (m *mockEmitter) Emit(_ context.Context, event string, data any) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.events = append(m.events, emittedEvent{event, data})
}

// waitForEvents polls until at least n events are captured (or deadline).
func (m *mockEmitter) waitForEvents(t *testing.T, n int) {
	t.Helper()
	deadline := time.After(2 * time.Second)
	tick := time.NewTicker(time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-deadline:
			t.Fatalf("timed out waiting for %d events", n)
		case <-tick.C:
			m.mu.Lock()
			count := len(m.events)
			m.mu.Unlock()
			if count >= n {
				return
			}
		}
	}
}

func (m *mockEmitter) lastAction(t *testing.T) PendingAction {
	t.Helper()
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.events) == 0 {
		t.Fatal("no events captured")
	}
	return m.events[len(m.events)-1].data.(PendingAction)
}

func newTestQueue() (*ApprovalQueue, *mockEmitter) {
	em := &mockEmitter{}
	q := NewApprovalQueue(context.Background(), em)
	q.timeout = 500 * time.Millisecond // fast timeout for tests
	return q, em
}

func TestApproval_ApproveFlow(t *testing.T) {
	q, em := newTestQueue()

	var approved bool
	var err error
	done := make(chan struct{})

	go func() {
		approved, err = q.Request("delete_block", "Delete block X")
		close(done)
	}()

	em.waitForEvents(t, 1)

	em.mu.Lock()
	ev := em.events[0]
	em.mu.Unlock()

	if ev.event != "mcp:approval-required" {
		t.Fatalf("event = %q, want mcp:approval-required", ev.event)
	}

	action := ev.data.(PendingAction)
	q.Approve(action.ID)

	<-done
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !approved {
		t.Error("expected approved = true")
	}
}

func TestApproval_RejectFlow(t *testing.T) {
	q, em := newTestQueue()

	var approved bool
	var err error
	done := make(chan struct{})

	go func() {
		approved, err = q.Request("delete_block", "Delete block X")
		close(done)
	}()

	em.waitForEvents(t, 1)
	action := em.lastAction(t)
	q.Reject(action.ID)

	<-done
	if approved {
		t.Error("expected approved = false")
	}
	if err == nil {
		t.Error("expected rejection error")
	}
}

func TestApproval_Timeout(t *testing.T) {
	q, _ := newTestQueue()
	q.timeout = 50 * time.Millisecond

	start := time.Now()
	approved, err := q.Request("delete_block", "Delete block X")
	elapsed := time.Since(start)

	if approved {
		t.Error("timed-out request should not be approved")
	}
	if err == nil {
		t.Error("expected timeout error")
	}
	if elapsed < 40*time.Millisecond {
		t.Errorf("returned too fast: %v", elapsed)
	}
}

func TestApproval_CleanupRemovesPending(t *testing.T) {
	q, em := newTestQueue()

	done := make(chan struct{})
	go func() {
		q.Request("test", "test")
		close(done)
	}()

	em.waitForEvents(t, 1)
	action := em.lastAction(t)
	q.Approve(action.ID)
	<-done

	// After approval, pending map should be empty
	q.mu.Lock()
	count := len(q.pending)
	q.mu.Unlock()

	if count != 0 {
		t.Errorf("pending count = %d, want 0 after cleanup", count)
	}
}

func TestApproval_ConcurrentRequests(t *testing.T) {
	q, em := newTestQueue()

	const n = 5
	var wg sync.WaitGroup
	results := make([]bool, n)

	for i := range n {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			approved, _ := q.Request("tool", "desc")
			results[idx] = approved
		}(i)
	}

	em.waitForEvents(t, n)

	em.mu.Lock()
	events := make([]emittedEvent, len(em.events))
	copy(events, em.events)
	em.mu.Unlock()

	// Approve all
	for _, ev := range events {
		if ev.event == "mcp:approval-required" {
			action := ev.data.(PendingAction)
			q.Approve(action.ID)
		}
	}

	wg.Wait()

	for i, r := range results {
		if !r {
			t.Errorf("request[%d] not approved", i)
		}
	}
}

func TestApproval_MetadataPassthrough(t *testing.T) {
	q, em := newTestQueue()

	done := make(chan struct{})
	go func() {
		q.Request("tool", "desc", `{"blockIds":["b1"]}`)
		close(done)
	}()

	em.waitForEvents(t, 1)
	action := em.lastAction(t)

	if action.Metadata != `{"blockIds":["b1"]}` {
		t.Errorf("metadata = %q, want JSON with blockIds", action.Metadata)
	}
	if action.Tool != "tool" {
		t.Errorf("tool = %q, want tool", action.Tool)
	}

	q.Approve(action.ID)
	<-done
}

func TestApproval_DefaultMetadata(t *testing.T) {
	q, em := newTestQueue()

	done := make(chan struct{})
	go func() {
		q.Request("tool", "desc") // no metadata
		close(done)
	}()

	em.waitForEvents(t, 1)
	action := em.lastAction(t)

	if action.Metadata != "{}" {
		t.Errorf("default metadata = %q, want {}", action.Metadata)
	}

	q.Approve(action.ID)
	<-done
}

func TestApproval_ApproveUnknownID(t *testing.T) {
	q, _ := newTestQueue()
	// Should not panic
	q.Approve("nonexistent")
	q.Reject("nonexistent")
}
