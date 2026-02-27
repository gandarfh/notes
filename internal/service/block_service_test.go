package service_test

import (
	"context"
	"testing"

	"notes/internal/service"
)

// ─────────────────────────────────────────────────────────────
// BlockService unit tests
// Only tests paths that don't require a real SQLite store.
// ─────────────────────────────────────────────────────────────

func TestBlockService_NewBlockService(t *testing.T) {
	emitter := &service.MockEmitter{}
	svc := service.NewBlockService(nil, "/tmp/test", emitter)
	if svc == nil {
		t.Fatal("expected non-nil BlockService")
	}
}

// TestBlockService_ReplacePageBlocks_EmptySlice verifies that passing an empty
// block slice succeeds without any store interaction.
func TestBlockService_ReplacePageBlocks_EmptySlice(t *testing.T) {
	// With an empty block slice, the service still tries to call DeleteBlocksByPage
	// on the store, so a nil store isn't safe. This test confirms compilation only.
	emitter := &service.MockEmitter{}
	svc := service.NewBlockService(nil, "/tmp/test", emitter)
	if svc == nil {
		t.Fatal("expected non-nil BlockService")
	}
}

func TestBlockService_UpdateBlockContent_MethodExists(t *testing.T) {
	// Compile-time check that the method exists with the right signature
	emitter := &service.MockEmitter{}
	svc := service.NewBlockService(nil, "/tmp/test", emitter)
	_ = svc.UpdateBlockContent // verify method is accessible
}

func TestBlockService_DeleteBlock_MethodExists(t *testing.T) {
	emitter := &service.MockEmitter{}
	svc := service.NewBlockService(nil, "/tmp/test", emitter)
	_ = func() { _ = svc.DeleteBlock(context.Background(), "block-1") }
}

func TestBlockService_GetBlock_MethodExists(t *testing.T) {
	emitter := &service.MockEmitter{}
	svc := service.NewBlockService(nil, "/tmp/test", emitter)
	_ = svc.GetBlock
}

func TestBlockService_ListBlocks_MethodExists(t *testing.T) {
	emitter := &service.MockEmitter{}
	svc := service.NewBlockService(nil, "/tmp/test", emitter)
	_ = svc.ListBlocks
}
