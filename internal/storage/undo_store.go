package storage

import (
	"database/sql"
	"fmt"
	"time"
)

// UndoNode represents a single undo history entry.
type UndoNode struct {
	ID           string    `json:"id"`
	PageID       string    `json:"pageId"`
	ParentID     *string   `json:"parentId"`
	Label        string    `json:"label"`
	SnapshotJSON string    `json:"snapshotJson"`
	CreatedAt    time.Time `json:"createdAt"`
}

// UndoTree is the full tree returned to the frontend.
type UndoTree struct {
	Nodes     []UndoNode `json:"nodes"`
	CurrentID string     `json:"currentId"`
	RootID    string     `json:"rootId"`
}

// UndoStore manages undo history in SQLite.
type UndoStore struct {
	db *DB
}

func NewUndoStore(db *DB) *UndoStore {
	return &UndoStore{db: db}
}

// LoadTree returns the full undo tree for a page.
func (s *UndoStore) LoadTree(pageID string) (*UndoTree, error) {
	rows, err := s.db.Conn().Query(
		`SELECT id, page_id, parent_id, label, snapshot_json, created_at
		 FROM undo_nodes WHERE page_id = ? ORDER BY created_at ASC`, pageID,
	)
	if err != nil {
		return nil, fmt.Errorf("load undo nodes: %w", err)
	}
	defer rows.Close()

	var nodes []UndoNode
	var rootID string
	for rows.Next() {
		var n UndoNode
		if err := rows.Scan(&n.ID, &n.PageID, &n.ParentID, &n.Label, &n.SnapshotJSON, &n.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan undo node: %w", err)
		}
		if n.ParentID == nil {
			rootID = n.ID
		}
		nodes = append(nodes, n)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(nodes) == 0 {
		return nil, nil // No tree yet
	}

	// Get current position
	var currentID string
	err = s.db.Conn().QueryRow(
		`SELECT current_node_id FROM undo_state WHERE page_id = ?`, pageID,
	).Scan(&currentID)
	if err != nil {
		currentID = rootID // Fallback
	}

	return &UndoTree{
		Nodes:     nodes,
		CurrentID: currentID,
		RootID:    rootID,
	}, nil
}

// PushNode creates a new undo node with the given ID under the specified parent.
// Both nodeID and parentID are passed from the frontend to keep IDs in sync.
func (s *UndoStore) PushNode(pageID, nodeID, parentID, label, snapshotJSON string) (*UndoNode, error) {
	now := time.Now()

	var pID *string
	if parentID != "" {
		pID = &parentID
	}

	// Insert new node
	_, err := s.db.Conn().Exec(
		`INSERT INTO undo_nodes (id, page_id, parent_id, label, snapshot_json, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		nodeID, pageID, pID, label, snapshotJSON, now,
	)
	if err != nil {
		return nil, fmt.Errorf("insert undo node: %w", err)
	}

	// Update current position
	_, err = s.db.Conn().Exec(
		`INSERT INTO undo_state (page_id, current_node_id) VALUES (?, ?)
		 ON CONFLICT(page_id) DO UPDATE SET current_node_id = excluded.current_node_id`,
		pageID, nodeID,
	)
	if err != nil {
		return nil, fmt.Errorf("update undo state: %w", err)
	}

	// Prune if over limit
	s.pruneIfNeeded(pageID, 40)

	node := &UndoNode{
		ID:           nodeID,
		PageID:       pageID,
		ParentID:     pID,
		Label:        label,
		SnapshotJSON: snapshotJSON,
		CreatedAt:    now,
	}
	return node, nil
}

// GoTo updates the current position pointer.
func (s *UndoStore) GoTo(pageID, nodeID string) error {
	_, err := s.db.Conn().Exec(
		`INSERT INTO undo_state (page_id, current_node_id) VALUES (?, ?)
		 ON CONFLICT(page_id) DO UPDATE SET current_node_id = excluded.current_node_id`,
		pageID, nodeID,
	)
	return err
}

// ClearPage removes all undo data for a page.
func (s *UndoStore) ClearPage(pageID string) error {
	_, _ = s.db.Conn().Exec(`DELETE FROM undo_state WHERE page_id = ?`, pageID)
	_, err := s.db.Conn().Exec(`DELETE FROM undo_nodes WHERE page_id = ?`, pageID)
	return err
}

// pruneIfNeeded removes oldest nodes when count exceeds maxNodes.
func (s *UndoStore) pruneIfNeeded(pageID string, maxNodes int) {
	var count int
	s.db.Conn().QueryRow(`SELECT COUNT(*) FROM undo_nodes WHERE page_id = ?`, pageID).Scan(&count)
	if count <= maxNodes {
		return
	}

	toDelete := count - maxNodes

	// Get current node BEFORE opening rows cursor (avoid nested query deadlock)
	var currentID string
	s.db.Conn().QueryRow(`SELECT current_node_id FROM undo_state WHERE page_id = ?`, pageID).Scan(&currentID)

	// Collect IDs to delete FIRST (close rows before doing any writes)
	rows, err := s.db.Conn().Query(
		`SELECT id FROM undo_nodes WHERE page_id = ?
		 ORDER BY created_at ASC LIMIT ?`, pageID, toDelete,
	)
	if err != nil {
		return
	}

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			continue
		}
		if id != currentID {
			ids = append(ids, id)
		}
	}
	rows.Close()

	// Now process deletions (no open rows cursor)
	for _, id := range ids {
		var parentID sql.NullString
		s.db.Conn().QueryRow(`SELECT parent_id FROM undo_nodes WHERE id = ?`, id).Scan(&parentID)

		if parentID.Valid {
			s.db.Conn().Exec(
				`UPDATE undo_nodes SET parent_id = ? WHERE parent_id = ?`,
				parentID.String, id,
			)
		} else {
			s.db.Conn().Exec(
				`UPDATE undo_nodes SET parent_id = NULL WHERE parent_id = ?`, id,
			)
		}

		s.db.Conn().Exec(`DELETE FROM undo_nodes WHERE id = ?`, id)
	}
}
