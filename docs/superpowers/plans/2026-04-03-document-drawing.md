# Document Drawing Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add drawing support to the document page type so users can draw over document content with invisible spacers preserving text flow.

**Architecture:** A `DocumentDrawingLayer` wrapper component sits inside `DocumentView`, housing two `<canvas>` elements and an overlay `<div>` on top of the TipTap `EditorContent`. The existing `useDrawing` hook is reused with a fixed viewport `{x:0, y:0, zoom:1}`. A `drawingSpacer` TipTap node extension creates invisible blocks that reserve vertical space for drawing clusters, persisted as HTML in the markdown content.

**Tech Stack:** React, TipTap (ProseMirror), Zustand, WASM drawing engine (existing), TypeScript

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/components/Board/extensions/DrawingSpacerExtension.ts` | Create | TipTap node extension — invisible atom block with `spacerId` and `height` attributes |
| `frontend/src/components/Board/DocumentDrawingLayer.tsx` | Create | Wrapper component — canvas refs, `useDrawing`, spacer sync logic, pointer-event routing |
| `frontend/src/components/Board/DocumentView.tsx` | Modify | Register `DrawingSpacerExtension`, wrap content with `DocumentDrawingLayer` |
| `frontend/src/components/Board/DocumentView.css` | Modify | Add `.doc-drawing-wrapper` and `.drawing-spacer` styles |

---

### Task 1: Create DrawingSpacerExtension

**Files:**
- Create: `frontend/src/components/Board/extensions/DrawingSpacerExtension.ts`

- [ ] **Step 1: Create the TipTap node extension**

```ts
// frontend/src/components/Board/extensions/DrawingSpacerExtension.ts
import { Node, mergeAttributes } from '@tiptap/core'

export const DrawingSpacerExtension = Node.create({
    name: 'drawingSpacer',
    group: 'block',
    atom: true,
    selectable: false,
    draggable: false,

    addAttributes() {
        return {
            spacerId: {
                default: '',
                parseHTML: (el: HTMLElement) => el.getAttribute('data-spacer-id') || '',
                renderHTML: (attrs: Record<string, any>) => ({ 'data-spacer-id': attrs.spacerId }),
            },
            height: {
                default: 100,
                parseHTML: (el: HTMLElement) => parseInt(el.getAttribute('data-height') || '100', 10),
                renderHTML: (attrs: Record<string, any>) => ({ 'data-height': attrs.height }),
            },
        }
    },

    parseHTML() {
        return [{ tag: 'div[data-drawing-spacer]' }]
    },

    renderHTML({ HTMLAttributes }) {
        const height = HTMLAttributes['data-height'] || 100
        return ['div', mergeAttributes(HTMLAttributes, {
            'data-drawing-spacer': '',
            class: 'drawing-spacer',
            style: `height: ${height}px`,
        })]
    },
})
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/joao/gandarfh/notes/frontend && npx tsc --noEmit`
Expected: No errors related to `DrawingSpacerExtension`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Board/extensions/DrawingSpacerExtension.ts
git commit -m "feat: add DrawingSpacerExtension TipTap node for invisible drawing spacers"
```

---

### Task 2: Add spacer CSS styles

**Files:**
- Modify: `frontend/src/components/Board/DocumentView.css`

- [ ] **Step 1: Add spacer and wrapper styles to DocumentView.css**

Append at the end of the file:

```css
/* ── Drawing Spacer ───────────────────────────────────────── */

.drawing-spacer {
  pointer-events: none;
  user-select: none;
  position: relative;
}

/* ── Document Drawing Wrapper ─────────────────────────────── */

.doc-drawing-wrapper {
  position: relative;
  width: 100%;
  min-height: 100%;
}

.doc-drawing-wrapper .drawing-canvas,
.doc-drawing-wrapper .drawing-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  pointer-events: none;
  will-change: transform;
  transform-origin: 0 0;
}

.doc-drawing-wrapper .drawing-canvas {
  z-index: 1;
}

.doc-drawing-wrapper .drawing-overlay {
  z-index: 4;
}

.doc-drawing-wrapper .doc-drawing-layer {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  transform-origin: 0 0;
}

.doc-drawing-wrapper.drawing-active .document-editor {
  pointer-events: none;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/Board/DocumentView.css
git commit -m "style: add CSS for drawing spacers and document drawing wrapper"
```

---

### Task 3: Create DocumentDrawingLayer component

**Files:**
- Create: `frontend/src/components/Board/DocumentDrawingLayer.tsx`

- [ ] **Step 1: Create the component**

```tsx
// frontend/src/components/Board/DocumentDrawingLayer.tsx
import { useRef, useEffect, useCallback } from 'react'
import { useAppStore } from '../../store'
import { useDrawing } from '../../hooks/useDrawing'
import { InlineEditor } from '../Drawing/InlineEditor'
import { StylePanel } from '../StylePanel/StylePanel'
import { setClearDrawingSelection } from '../../input/drawingBridge'
import type { Editor } from '@tiptap/react'
import type { DrawingElement } from '../../drawing/types'
import { getElementBounds } from '../../drawing/types'

interface Props {
    editor: Editor | null
    children: React.ReactNode
}

/** Cluster of drawing elements that occupy a vertical region */
interface DrawingCluster {
    id: string
    top: number
    bottom: number
    height: number
}

/**
 * Groups drawing elements into vertical clusters.
 * Elements within `gap` pixels of each other vertically are merged.
 */
function computeClusters(elements: DrawingElement[], gap = 20): DrawingCluster[] {
    if (elements.length === 0) return []

    // Get bounding boxes for all elements
    const boxes = elements.map(el => {
        const bounds = getElementBounds(el)
        return { top: bounds.y, bottom: bounds.y + bounds.height }
    })

    // Sort by top position
    boxes.sort((a, b) => a.top - b.top)

    const clusters: DrawingCluster[] = []
    let current = { top: boxes[0].top, bottom: boxes[0].bottom }

    for (let i = 1; i < boxes.length; i++) {
        if (boxes[i].top <= current.bottom + gap) {
            // Merge into current cluster
            current.bottom = Math.max(current.bottom, boxes[i].bottom)
        } else {
            // Finalize current cluster and start new one
            clusters.push({
                id: `cluster-${clusters.length}`,
                top: current.top,
                bottom: current.bottom,
                height: current.bottom - current.top,
            })
            current = { top: boxes[i].top, bottom: boxes[i].bottom }
        }
    }

    // Finalize last cluster
    clusters.push({
        id: `cluster-${clusters.length}`,
        top: current.top,
        bottom: current.bottom,
        height: current.bottom - current.top,
    })

    return clusters
}

export function DocumentDrawingLayer({ editor, children }: Props) {
    const wrapperRef = useRef<HTMLDivElement>(null)
    const drawingSvgRef = useRef<HTMLCanvasElement>(null)
    const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
    const drawingLayerRef = useRef<HTMLDivElement>(null)

    const drawingSubTool = useAppStore(s => s.drawingSubTool)
    const drawingData = useAppStore(s => s.drawingData)

    // Determine if a drawing tool is active (not select, not empty)
    const isDrawingToolActive = drawingSubTool !== 'draw-select' && drawingSubTool !== ''

    // Block creation callback — no-op in document mode (blocks use TipTap embeds)
    const onBlockCreate = useCallback(async () => {}, [])

    const {
        editorRequest,
        closeEditor,
        renderDrawing,
        eventConsumedRef,
        clearDrawingSelection,
        styleSelection,
        updateSelectedStyle,
        reorderSelected,
        alignSelected,
        multiSelected,
    } = useDrawing(
        drawingSvgRef,
        overlayCanvasRef,
        wrapperRef,
        onBlockCreate,
    )

    // Register clearDrawingSelection globally
    useEffect(() => {
        setClearDrawingSelection(clearDrawingSelection)
        return () => setClearDrawingSelection(null)
    }, [clearDrawingSelection])

    // Lock viewport to {0,0,1} and render
    useEffect(() => {
        renderDrawing({ x: 0, y: 0, zoom: 1 })
    }, [renderDrawing])

    // Resize canvases when wrapper size changes
    useEffect(() => {
        const el = wrapperRef.current
        if (!el) return

        const obs = new ResizeObserver(() => {
            const height = el.scrollHeight
            const width = el.clientWidth

            if (drawingSvgRef.current) {
                drawingSvgRef.current.style.height = `${height}px`
            }
            if (overlayCanvasRef.current) {
                overlayCanvasRef.current.style.height = `${height}px`
            }
            if (drawingLayerRef.current) {
                drawingLayerRef.current.style.height = `${height}px`
            }

            renderDrawing({ x: 0, y: 0, zoom: 1 })
        })

        obs.observe(el)
        return () => obs.disconnect()
    }, [renderDrawing])

    // Sync spacers when drawing data changes
    useEffect(() => {
        if (!editor) return
        if (!drawingData) return

        let elements: DrawingElement[] = []
        try {
            elements = JSON.parse(drawingData)
        } catch { return }

        if (elements.length === 0) return

        const clusters = computeClusters(elements)
        syncSpacers(editor, clusters)
    }, [editor, drawingData])

    return (
        <div
            ref={wrapperRef}
            className={`doc-drawing-wrapper ${isDrawingToolActive ? 'drawing-active' : ''}`}
            style={{ cursor: isDrawingToolActive ? 'crosshair' : undefined }}
        >
            {children}

            <canvas
                ref={drawingSvgRef}
                className="drawing-canvas"
            />

            <canvas
                ref={overlayCanvasRef}
                className="drawing-overlay"
            />

            <div ref={drawingLayerRef} className="doc-drawing-layer">
                {editorRequest && (
                    <InlineEditor
                        request={editorRequest}
                        onClose={closeEditor}
                    />
                )}
            </div>

            {styleSelection.length > 0 && (
                <StylePanel
                    elements={styleSelection}
                    onUpdate={updateSelectedStyle}
                    onReorder={reorderSelected}
                    onAlign={alignSelected}
                    multiSelected={multiSelected}
                />
            )}
        </div>
    )
}

/**
 * Synchronize drawing spacer nodes in the TipTap editor with computed clusters.
 * - Updates existing spacers' height if changed
 * - Inserts new spacers for new clusters
 * - Removes orphan spacers whose cluster no longer exists
 */
function syncSpacers(editor: Editor, clusters: DrawingCluster[]) {
    const { state } = editor
    const { doc } = state

    // Collect existing spacer positions
    const existingSpacers: { pos: number; node: any; spacerId: string }[] = []
    doc.descendants((node, pos) => {
        if (node.type.name === 'drawingSpacer') {
            existingSpacers.push({ pos, node, spacerId: node.attrs.spacerId })
        }
    })

    const existingIds = new Set(existingSpacers.map(s => s.spacerId))
    const clusterIds = new Set(clusters.map(c => c.id))

    // Build a single transaction
    let tr = state.tr

    // Remove orphan spacers (reverse order to preserve positions)
    const toRemove = existingSpacers
        .filter(s => !clusterIds.has(s.spacerId))
        .reverse()

    for (const spacer of toRemove) {
        tr = tr.delete(spacer.pos, spacer.pos + spacer.node.nodeSize)
    }

    // Update existing spacers' height
    for (const spacer of existingSpacers) {
        if (!clusterIds.has(spacer.spacerId)) continue
        const cluster = clusters.find(c => c.id === spacer.spacerId)
        if (!cluster) continue
        if (spacer.node.attrs.height !== Math.round(cluster.height)) {
            tr = tr.setNodeMarkup(tr.mapping.map(spacer.pos), undefined, {
                ...spacer.node.attrs,
                height: Math.round(cluster.height),
            })
        }
    }

    // Insert new spacers for clusters that don't exist yet
    const newClusters = clusters.filter(c => !existingIds.has(c.id))
    for (const cluster of newClusters) {
        const spacerNode = editor.schema.nodes.drawingSpacer.create({
            spacerId: cluster.id,
            height: Math.round(cluster.height),
        })
        // Insert at the end of the document
        const endPos = tr.doc.content.size
        tr = tr.insert(endPos, spacerNode)
    }

    if (tr.docChanged) {
        editor.view.dispatch(tr)
    }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/joao/gandarfh/notes/frontend && npx tsc --noEmit`
Expected: No errors related to `DocumentDrawingLayer`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Board/DocumentDrawingLayer.tsx
git commit -m "feat: add DocumentDrawingLayer component with spacer sync logic"
```

---

### Task 4: Integrate into DocumentView

**Files:**
- Modify: `frontend/src/components/Board/DocumentView.tsx`

- [ ] **Step 1: Add imports**

At the top of `DocumentView.tsx`, add:

```ts
import { DrawingSpacerExtension } from './extensions/DrawingSpacerExtension'
import { DocumentDrawingLayer } from './DocumentDrawingLayer'
```

- [ ] **Step 2: Register DrawingSpacerExtension in useEditor**

In the `extensions` array inside `useEditor`, add `DrawingSpacerExtension` after `SlashMenuExtension`:

```ts
      SlashMenuExtension,
      DrawingSpacerExtension,
```

- [ ] **Step 3: Wrap EditorContent with DocumentDrawingLayer**

Replace the return JSX. Change:

```tsx
  return (
    <div className="document-view">
      {editor && (
        <BubbleMenu editor={editor}>
          {/* ... bubble menu content ... */}
        </BubbleMenu>
      )}
      <EditorContent editor={editor} />
    </div>
  );
```

To:

```tsx
  return (
    <div className="document-view">
      {editor && (
        <BubbleMenu editor={editor}>
          {/* ... bubble menu content ... */}
        </BubbleMenu>
      )}
      <DocumentDrawingLayer editor={editor}>
        <EditorContent editor={editor} />
      </DocumentDrawingLayer>
    </div>
  );
```

The `BubbleMenu` stays outside the wrapper because it's rendered as a floating portal by TipTap.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /Users/joao/gandarfh/notes/frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Verify plugin lint passes**

Run: `cd /Users/joao/gandarfh/notes/frontend && npm run lint:plugins`
Expected: No isolation violations

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Board/DocumentView.tsx
git commit -m "feat: integrate drawing layer into DocumentView"
```

---

### Task 5: Test end-to-end and fix issues

**Files:**
- Possibly modify: `frontend/src/components/Board/DocumentDrawingLayer.tsx`, `frontend/src/components/Board/DocumentView.css`

- [ ] **Step 1: Run the dev server**

Run: `cd /Users/joao/gandarfh/notes && make dev`

- [ ] **Step 2: Manual verification checklist**

Test in the running app:
1. Open a board page in document mode
2. Select a drawing tool (rectangle, freedraw) from the toolbar
3. Draw on the document — element should appear over the text
4. Switch back to text cursor — should be able to type below the drawing
5. Scroll the document — drawing elements scroll with the content
6. Select drawing elements — should be able to move, resize, delete
7. Use drawing box to multi-select elements
8. Verify spacers create space in the text flow for drawing regions
9. Close and reopen the page — drawings and spacers should persist
10. Switch to dashboard mode and back to document — drawings should remain

- [ ] **Step 3: Fix any pointer-event routing issues**

If TipTap captures events when drawing tools are active, verify that the `.drawing-active .document-editor { pointer-events: none }` CSS rule is applied. If the class isn't toggling, check that `isDrawingToolActive` correctly reflects the store state.

- [ ] **Step 4: Fix canvas sizing issues**

If the drawing canvas doesn't cover the full document height, check the `ResizeObserver` callback in `DocumentDrawingLayer`. The canvas `height` style must match `wrapperRef.current.scrollHeight`.

- [ ] **Step 5: Commit fixes**

```bash
git add -u
git commit -m "fix: resolve drawing layer integration issues in document mode"
```
