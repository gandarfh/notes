package storage

import (
	"testing"
)

func newUndoStore(t *testing.T) *UndoStore {
	t.Helper()
	return NewUndoStore(newTestDB(t))
}

func TestUndoStore_LoadTree_Empty(t *testing.T) {
	s := newUndoStore(t)

	tree, err := s.LoadTree("page-1")
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if tree != nil {
		t.Error("expected nil for empty tree")
	}
}

func TestUndoStore_PushNode_Root(t *testing.T) {
	s := newUndoStore(t)

	node, err := s.PushNode("page-1", "node-1", "", "initial", `{"blocks":[]}`)
	if err != nil {
		t.Fatalf("push: %v", err)
	}

	if node.ID != "node-1" {
		t.Errorf("id = %q, want node-1", node.ID)
	}
	if node.ParentID != nil {
		t.Errorf("parentID = %v, want nil", node.ParentID)
	}
	if node.Label != "initial" {
		t.Errorf("label = %q, want initial", node.Label)
	}
	if node.SnapshotJSON != `{"blocks":[]}` {
		t.Errorf("snapshot = %q", node.SnapshotJSON)
	}
}

func TestUndoStore_PushNode_WithParent(t *testing.T) {
	s := newUndoStore(t)

	s.PushNode("page-1", "node-1", "", "initial", "{}")
	node, err := s.PushNode("page-1", "node-2", "node-1", "edit", `{"blocks":[1]}`)
	if err != nil {
		t.Fatalf("push: %v", err)
	}

	if node.ParentID == nil || *node.ParentID != "node-1" {
		t.Errorf("parentID = %v, want node-1", node.ParentID)
	}
}

func TestUndoStore_LoadTree_WithNodes(t *testing.T) {
	s := newUndoStore(t)

	s.PushNode("page-1", "node-1", "", "initial", "{}")
	s.PushNode("page-1", "node-2", "node-1", "edit 1", "{}")
	s.PushNode("page-1", "node-3", "node-2", "edit 2", "{}")

	tree, err := s.LoadTree("page-1")
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	if len(tree.Nodes) != 3 {
		t.Fatalf("nodes len = %d, want 3", len(tree.Nodes))
	}
	if tree.RootID != "node-1" {
		t.Errorf("rootID = %q, want node-1", tree.RootID)
	}
	// Current should be the last pushed
	if tree.CurrentID != "node-3" {
		t.Errorf("currentID = %q, want node-3", tree.CurrentID)
	}
}

func TestUndoStore_GoTo(t *testing.T) {
	s := newUndoStore(t)

	s.PushNode("page-1", "node-1", "", "initial", "{}")
	s.PushNode("page-1", "node-2", "node-1", "edit 1", "{}")

	if err := s.GoTo("page-1", "node-1"); err != nil {
		t.Fatalf("goto: %v", err)
	}

	tree, _ := s.LoadTree("page-1")
	if tree.CurrentID != "node-1" {
		t.Errorf("currentID = %q, want node-1", tree.CurrentID)
	}
}

func TestUndoStore_ClearPage(t *testing.T) {
	s := newUndoStore(t)

	s.PushNode("page-1", "node-1", "", "initial", "{}")
	s.PushNode("page-1", "node-2", "node-1", "edit", "{}")

	if err := s.ClearPage("page-1"); err != nil {
		t.Fatalf("clear: %v", err)
	}

	tree, err := s.LoadTree("page-1")
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if tree != nil {
		t.Error("expected nil after clear")
	}
}

func TestUndoStore_Pruning(t *testing.T) {
	s := newUndoStore(t)

	// Push 45 nodes (limit is 40)
	s.PushNode("page-1", "node-0", "", "root", "{}")
	for i := 1; i <= 44; i++ {
		parentID := "node-0"
		if i > 1 {
			parentID = nodeID(i - 1)
		}
		s.PushNode("page-1", nodeID(i), parentID, "edit", "{}")
	}

	tree, err := s.LoadTree("page-1")
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	if len(tree.Nodes) > 40 {
		t.Errorf("nodes = %d, want <= 40 after pruning", len(tree.Nodes))
	}

	// Current node should still be valid
	if tree.CurrentID != nodeID(44) {
		t.Errorf("currentID = %q, want %q", tree.CurrentID, nodeID(44))
	}
}

func TestUndoStore_Pruning_PreservesCurrentNode(t *testing.T) {
	s := newUndoStore(t)

	// Push root and go back to it
	s.PushNode("page-1", "node-0", "", "root", `{"root":true}`)
	for i := 1; i <= 44; i++ {
		parentID := "node-0"
		if i > 1 {
			parentID = nodeID(i - 1)
		}
		s.PushNode("page-1", nodeID(i), parentID, "edit", "{}")
	}

	// Go back to an early node
	s.GoTo("page-1", "node-0")

	// Push more to trigger pruning
	s.PushNode("page-1", "node-new", "node-0", "new branch", "{}")

	tree, _ := s.LoadTree("page-1")

	// Current should point to the new node
	if tree.CurrentID != "node-new" {
		t.Errorf("currentID = %q, want node-new", tree.CurrentID)
	}
}

func TestUndoStore_BranchingHistory(t *testing.T) {
	s := newUndoStore(t)

	// Linear: root → a → b
	s.PushNode("page-1", "root", "", "root", "{}")
	s.PushNode("page-1", "a", "root", "branch a", "{}")
	s.PushNode("page-1", "b", "root", "branch b", "{}")

	tree, _ := s.LoadTree("page-1")

	// Both a and b have root as parent
	parentMap := make(map[string]string)
	for _, n := range tree.Nodes {
		if n.ParentID != nil {
			parentMap[n.ID] = *n.ParentID
		}
	}
	if parentMap["a"] != "root" {
		t.Errorf("a parent = %q, want root", parentMap["a"])
	}
	if parentMap["b"] != "root" {
		t.Errorf("b parent = %q, want root", parentMap["b"])
	}
}

func nodeID(i int) string {
	return "node-" + itoa(i)
}

func itoa(i int) string {
	return string(rune('0'+i/10)) + string(rune('0'+i%10))
}
