package service

import (
	"context"
	"sync"
)

// ─────────────────────────────────────────────────────────────
// EventEmitter — decouples services from wailsRuntime
// ─────────────────────────────────────────────────────────────

// EventEmitter is an interface for emitting events to the frontend.
// The App struct implements this by delegating to wailsRuntime.EventsEmit.
// Services receive this interface instead of a wailsRuntime context,
// which makes them independently testable with a mock emitter.
type EventEmitter interface {
	Emit(ctx context.Context, event string, data any)
}

// MockEmitter is a test-friendly EventEmitter that records all calls.
type MockEmitter struct {
	mu     sync.Mutex
	Events []EmittedEvent
}

// EmittedEvent holds a single recorded emission for test assertions.
type EmittedEvent struct {
	Event string
	Data  any
}

func (m *MockEmitter) Emit(_ context.Context, event string, data any) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Events = append(m.Events, EmittedEvent{Event: event, Data: data})
}
