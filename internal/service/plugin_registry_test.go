package service

import (
	"fmt"
	"testing"
)

// mockPlugin implements GoBlockPlugin for testing.
type mockPlugin struct {
	blockType    string
	createCalled bool
	deleteCalled bool
	createErr    error
	deleteErr    error
}

func (m *mockPlugin) BlockType() string { return m.blockType }
func (m *mockPlugin) OnCreate(blockID, pageID string) error {
	m.createCalled = true
	return m.createErr
}
func (m *mockPlugin) OnDelete(blockID string) error { m.deleteCalled = true; return m.deleteErr }

func TestGoPluginRegistry_Register(t *testing.T) {
	r := NewGoPluginRegistry()
	p := &mockPlugin{blockType: "localdb"}
	r.Register(p)

	// Should be able to create blocks of this type
	if err := r.OnCreate("b1", "p1", "localdb"); err != nil {
		t.Fatalf("on create: %v", err)
	}
	if !p.createCalled {
		t.Error("plugin OnCreate should have been called")
	}
}

func TestGoPluginRegistry_Register_DuplicatePanics(t *testing.T) {
	r := NewGoPluginRegistry()
	r.Register(&mockPlugin{blockType: "localdb"})

	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic on duplicate registration")
		}
	}()
	r.Register(&mockPlugin{blockType: "localdb"})
}

func TestGoPluginRegistry_OnCreate_UnknownType(t *testing.T) {
	r := NewGoPluginRegistry()

	// Should return nil for unregistered block types
	if err := r.OnCreate("b1", "p1", "unknown"); err != nil {
		t.Errorf("expected nil for unknown type, got %v", err)
	}
}

func TestGoPluginRegistry_OnCreate_Error(t *testing.T) {
	r := NewGoPluginRegistry()
	r.Register(&mockPlugin{blockType: "test", createErr: fmt.Errorf("create failed")})

	err := r.OnCreate("b1", "p1", "test")
	if err == nil {
		t.Fatal("expected error")
	}
	if err.Error() != "create failed" {
		t.Errorf("error = %q", err.Error())
	}
}

func TestGoPluginRegistry_OnDelete(t *testing.T) {
	r := NewGoPluginRegistry()
	p := &mockPlugin{blockType: "localdb"}
	r.Register(p)

	if err := r.OnDelete("b1", "localdb"); err != nil {
		t.Fatalf("on delete: %v", err)
	}
	if !p.deleteCalled {
		t.Error("plugin OnDelete should have been called")
	}
}

func TestGoPluginRegistry_OnDelete_UnknownType(t *testing.T) {
	r := NewGoPluginRegistry()

	if err := r.OnDelete("b1", "unknown"); err != nil {
		t.Errorf("expected nil for unknown type, got %v", err)
	}
}

func TestGoPluginRegistry_OnDelete_Error(t *testing.T) {
	r := NewGoPluginRegistry()
	r.Register(&mockPlugin{blockType: "test", deleteErr: fmt.Errorf("delete failed")})

	err := r.OnDelete("b1", "test")
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestGoPluginRegistry_ForEach(t *testing.T) {
	r := NewGoPluginRegistry()
	r.Register(&mockPlugin{blockType: "a"})
	r.Register(&mockPlugin{blockType: "b"})
	r.Register(&mockPlugin{blockType: "c"})

	var types []string
	r.ForEach(func(p GoBlockPlugin) {
		types = append(types, p.BlockType())
	})

	if len(types) != 3 {
		t.Fatalf("len = %d, want 3", len(types))
	}
}
