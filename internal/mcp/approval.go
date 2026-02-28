package mcpserver

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
)

// EventEmitter allows the approval queue to notify the frontend.
type EventEmitter interface {
	Emit(ctx context.Context, event string, data any)
}

// PendingAction represents a destructive operation awaiting user approval.
type PendingAction struct {
	ID          string `json:"id"`
	Tool        string `json:"tool"`
	Description string `json:"description"`
	CreatedAt   string `json:"createdAt"`
	Metadata    string `json:"metadata"` // JSON with extra context (e.g. element IDs)
}

// actionResult is sent through the channel when user approves/rejects.
type actionResult struct {
	approved bool
}

// ApprovalQueue manages human-in-the-loop approval for destructive MCP tool calls.
// It supports two modes:
//   - In-process (Wails app running MCP): uses channels + Wails events
//   - DB-based (standalone MCP): writes to mcp_approvals table, polls for result
type ApprovalQueue struct {
	mu      sync.Mutex
	pending map[string]chan actionResult
	ctx     context.Context
	emitter EventEmitter
	timeout time.Duration
	// DB-based mode for standalone MCP (cross-process IPC)
	db *sql.DB
}

func NewApprovalQueue(ctx context.Context, emitter EventEmitter) *ApprovalQueue {
	return &ApprovalQueue{
		pending: make(map[string]chan actionResult),
		ctx:     ctx,
		emitter: emitter,
		timeout: 120 * time.Second,
	}
}

// SetDB enables DB-based approval mode for standalone MCP.
// The standalone process writes pending actions to SQLite and polls for results.
func (q *ApprovalQueue) SetDB(db *sql.DB) {
	q.db = db
}

// Request sends an approval request and blocks until approved/rejected.
// metadata is optional JSON with extra context (e.g. element IDs for highlighting).
func (q *ApprovalQueue) Request(tool, description string, metadata ...string) (bool, error) {
	id := uuid.New().String()
	meta := "{}"
	if len(metadata) > 0 && metadata[0] != "" {
		meta = metadata[0]
	}

	if q.db != nil {
		return q.requestViaDB(id, tool, description, meta)
	}
	return q.requestViaChannel(id, tool, description, meta)
}

// requestViaDB writes a pending approval to SQLite and polls until resolved.
func (q *ApprovalQueue) requestViaDB(id, tool, description, metadata string) (bool, error) {
	// Insert pending approval
	_, err := q.db.Exec(
		`INSERT INTO mcp_approvals (id, tool, description, status, metadata) VALUES (?, ?, ?, 'pending', ?)`,
		id, tool, description, metadata,
	)
	if err != nil {
		return false, fmt.Errorf("insert approval: %w", err)
	}

	// Poll for result
	deadline := time.Now().Add(q.timeout)
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			if time.Now().After(deadline) {
				// Timeout — clean up and reject
				q.db.Exec(`DELETE FROM mcp_approvals WHERE id = ?`, id)
				return false, fmt.Errorf("action timed out after %s: %s", q.timeout, tool)
			}
			var status string
			err := q.db.QueryRow(`SELECT status FROM mcp_approvals WHERE id = ?`, id).Scan(&status)
			if err != nil {
				continue
			}
			if status == "approved" {
				q.db.Exec(`DELETE FROM mcp_approvals WHERE id = ?`, id)
				return true, nil
			}
			if status == "rejected" {
				q.db.Exec(`DELETE FROM mcp_approvals WHERE id = ?`, id)
				return false, fmt.Errorf("action rejected by user: %s", tool)
			}
			// Still pending — continue polling
		case <-q.ctx.Done():
			q.db.Exec(`DELETE FROM mcp_approvals WHERE id = ?`, id)
			return false, fmt.Errorf("context cancelled")
		}
	}
}

// requestViaChannel is the original in-process mode using Wails events.
func (q *ApprovalQueue) requestViaChannel(id, tool, description, metadata string) (bool, error) {
	ch := make(chan actionResult, 1)

	q.mu.Lock()
	q.pending[id] = ch
	q.mu.Unlock()

	// Notify frontend
	q.emitter.Emit(q.ctx, "mcp:approval-required", PendingAction{
		ID:          id,
		Tool:        tool,
		Description: description,
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
		Metadata:    metadata,
	})

	// Block until approved, rejected, or timeout
	select {
	case result := <-ch:
		q.cleanup(id)
		if !result.approved {
			return false, fmt.Errorf("action rejected by user: %s", tool)
		}
		return true, nil
	case <-time.After(q.timeout):
		q.cleanup(id)
		// Notify frontend to dismiss
		q.emitter.Emit(q.ctx, "mcp:approval-dismissed", map[string]string{"id": id})
		return false, fmt.Errorf("action timed out after %s: %s", q.timeout, tool)
	}
}

// Approve marks a pending action as approved (in-process mode).
func (q *ApprovalQueue) Approve(actionID string) {
	q.mu.Lock()
	ch, ok := q.pending[actionID]
	q.mu.Unlock()
	if ok {
		ch <- actionResult{approved: true}
	}
}

// Reject marks a pending action as rejected (in-process mode).
func (q *ApprovalQueue) Reject(actionID string) {
	q.mu.Lock()
	ch, ok := q.pending[actionID]
	q.mu.Unlock()
	if ok {
		ch <- actionResult{approved: false}
	}
}

func (q *ApprovalQueue) cleanup(id string) {
	q.mu.Lock()
	delete(q.pending, id)
	q.mu.Unlock()
}
