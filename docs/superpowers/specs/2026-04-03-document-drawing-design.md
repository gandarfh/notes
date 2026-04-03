# Document Drawing Layer

**Date:** 2026-04-03
**Status:** Approved

## Summary

Add drawing support to the document page type (board mode = `document`). Drawing elements float over the document content and scroll with it. Invisible spacer nodes in TipTap reserve vertical space so text flows naturally below drawing regions.

## Current State

- Drawing works on `canvas` pages and `dashboard` (board) pages via `Canvas.tsx` + `useDrawing` hook
- `DocumentView` is a standalone TipTap editor with no drawing capabilities
- `drawingData` is already loaded into the Zustand store for all page types (including board/document) but not rendered in document mode
- Backend already persists `drawingData` per page — no Go changes needed

## Architecture

### Component Structure

```
DocumentView (wrapper, position: relative)
├── EditorContent (TipTap — normal document flow)
│   ├── text content
│   ├── drawingSpacer nodes (invisible, height = cluster bounding box)
│   └── more text content
├── <canvas> drawingSvgRef (position: absolute, inset: 0, z-index: 1)
│   └── Web Worker + WASM rendering of drawing elements
├── <canvas> overlayCanvasRef (position: absolute, inset: 0, z-index: 4)
│   └── Selection handles, box select (main thread Canvas2D)
└── <div> drawingLayerRef (position: absolute, inset: 0, z-index: 2)
    └── InlineEditor for text editing on drawing elements
```

All layers are inside the scrollable `.document-view` container, so they scroll naturally with the content.

### Viewport

Fixed at `{x: 0, y: 0, zoom: 1}` — no pan/zoom. Same approach as dashboard mode.

### Event Routing

- **Drawing tool active** (rectangle, freedraw, arrow, etc.): canvas layers get `pointer-events: auto`, TipTap editor gets `pointer-events: none`
- **No drawing tool** (or draw-select with no element under cursor): TipTap gets events, canvas layers get `pointer-events: none`
- `Escape` key or deselecting drawing tool returns to text editing mode
- `eventConsumedRef` from `useDrawing` determines if drawing consumed the event

## Drawing Spacers

### Concept

Drawing elements have Y coordinates relative to the top of the document. To prevent text from overlapping with drawings, invisible TipTap nodes ("spacers") reserve the vertical space occupied by drawing element clusters.

### Cluster Calculation

- A **cluster** is a group of drawing elements whose bounding boxes overlap or are within ~20px vertically
- Each cluster produces: `{ id: string, top: number, height: number }`
- Clusters are recalculated on every drawing interaction end (mouseUp after create/move/resize/delete)

### TipTap Node Extension: `drawingSpacer`

```ts
Node.create({
  name: 'drawingSpacer',
  group: 'block',
  atom: true,
  selectable: false,
  draggable: false,
  attrs: {
    spacerId: { default: '' },
    height: { default: 100 },
  },
})
```

- Renders as an invisible `<div>` with dynamic height
- CSS: no borders, no background, `pointer-events: none`, `user-select: none`

### Persistence

- Spacers **are persisted** in the TipTap HTML content as `<div>` elements with `data-` attributes (TipTap's native `renderHTML`/`parseHTML` handles serialization)
- The Markdown extension serializes them as an HTML block: `<div data-type="drawingSpacer" data-spacer-id="..." data-height="..."></div>`
- When the document opens, spacers are already in place — no layout shift or flicker
- When drawing elements change (create/move/resize/delete), clusters are recalculated and spacers updated in TipTap content
- This ensures the document opens with correct spacing immediately

### Spacer Positioning in TipTap

- On recalculation: iterate TipTap nodes, compute cumulative Y offset via `editor.view.coordsAtPos`
- Insert spacer **before** the node whose Y position exceeds the cluster's `top`
- If cluster is below all content, insert at the end
- Update existing spacers' height if cluster dimensions changed
- Remove orphan spacers whose cluster no longer exists

## New Files

| File | Purpose |
|------|---------|
| `frontend/src/components/Board/extensions/DrawingSpacerExtension.ts` | TipTap node extension for the invisible spacer (atom, persisted as HTML comment) |
| `frontend/src/components/Board/DocumentDrawingLayer.tsx` | Wrapper component: creates canvas refs, calls `useDrawing`, manages spacer sync |

## Modified Files

| File | Change |
|------|--------|
| `frontend/src/components/Board/DocumentView.tsx` | Wrap content with `DocumentDrawingLayer`, pass editor ref |
| `frontend/src/components/Board/DocumentView.css` | Add wrapper styles (position: relative) and `.drawing-spacer` styles |

## What Does NOT Change

- **Backend Go** — `drawingData` already persisted per page
- **`useDrawing` hook** — reused as-is with fixed viewport
- **Toolbar** — already shows drawing tools for all page types
- **Zustand store/slices** — `drawingData` already loads for board pages
- **Drawing Worker/WASM** — rendering pipeline unchanged

## Canvas Sizing

- A `ResizeObserver` on the wrapper monitors total height (changes when TipTap content grows/shrinks or spacers are added)
- When height changes, resize both canvas elements to cover the full area
- Call `renderDrawing({x:0, y:0, zoom:1})` after resize

## Interaction Flow

1. Document opens -> TipTap loads content (with persisted spacers) + `drawingData` loads from store
2. `DocumentDrawingLayer` initializes `useDrawing` with canvas refs -> renders elements at correct positions over spacers
3. User selects drawing tool -> `pointer-events` switch to canvas layers, TipTap becomes inert
4. User draws -> element created -> mouseUp -> recalculate clusters -> insert/update spacers in TipTap -> save content (with spacers) + save `drawingData`
5. User clicks outside or presses Escape -> returns to text mode, TipTap editable
6. Scroll -> everything moves together naturally (canvas inside scroll container)
7. User selects existing drawing elements -> can move, resize, delete, use drawing box for multi-select — same as canvas
