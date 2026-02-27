# Plugin SDK

> Everything a plugin can import from `../sdk` and `../shared`.

## Rules

1. **Import only from** `../sdk`, `../shared`, and your own plugin directory
2. **Never import** `../../store`, `../../bridge/wails` (value imports), another plugin's directory, or `window.go` / `window.runtime`
3. **Type-only imports** from `../../bridge/wails` are allowed (they vanish at compile time)

---

## How to Create a Plugin (Step-by-Step)

### 1. Scaffold the directory

```
plugins/
  my-thing/
    index.tsx         # Plugin entry: Renderer + plugin export
    mything.css       # Colocated CSS (prefix: .mt-)
```

> **Minimal plugins** (like `drawing` or `image`) can skip the CSS file and use Tailwind utilities directly if they have very few styling needs.

### 2. Create the Renderer component

```tsx
// plugins/my-thing/index.tsx
import './mything.css'
import { useState, useEffect } from 'react'
import type { BlockPlugin, PluginRendererProps, PluginContext } from '../sdk'

function MyThingRenderer({ block, isEditing, isSelected, ctx }: PluginRendererProps) {

  // ctx.storage — read/write block content
  // ctx.rpc.call('GoMethodName', ...args) — call Go backend
  // ctx.events.on('event:name', handler) — listen to other plugins
  // ctx.block — read block metadata (id, pageId, width, height)
  // ctx.ui.toast('message', 'success') — show notifications

  return (
    <div className="mt-container" onMouseDown={e => e.stopPropagation()}>
      {/* your UI here */}
    </div>
  )
}
```

> **`memo()` is optional.** Use it for Renderers that benefit from shallow-equal prop comparison (markdown, code). Skip it when the block re-renders frequently anyway.

### 3. Define the plugin export

```tsx
function MyThingIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      {/* icon paths */}
    </svg>
  )
}

export const myThingPlugin: BlockPlugin = {
  type: 'my-thing',            // unique key (stored in DB)
  label: 'My Thing',           // toolbar display name
  Icon: MyThingIcon,           // toolbar icon component
  defaultSize: { width: 400, height: 300 },
  headerLabel: 'THING',        // block header short label
  Renderer: MyThingRenderer,

  // Capabilities (all optional, all default to false):
  capabilities: {
    editable: false,            // true → opens Neovim editor on edit
    zeroPadding: false,         // true → removes default content padding
    headerless: false,          // true → no header, no shadow (e.g. image)
    aspectRatioResize: false,   // true → lock aspect ratio on resize
    smallBorderRadius: false,   // true → use border-radius-sm
  },

  // Optional lifecycle hooks:
  // onInit(ctx) { return cleanup },
  // onBlockCreate(ctx) { ... },

  // Optional header widget (e.g. font size picker, language selector):
  // HeaderExtension: MyThingHeaderExtension,

  // Optional public API for other plugins:
  // publicAPI(ctx) { return { myMethod() { ... } } },
}
```

### 4. Create colocated CSS

```css
/* plugins/my-thing/mything.css */

/* ALL classes MUST be prefixed with .mt- */

.mt-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  color: var(--color-text-primary);    /* always use CSS custom properties */
}

.mt-header {
  padding: 4px 10px;
  border-bottom: 1px solid var(--color-border-subtle);
}
```

**CSS rules:**
- Prefix all class names with plugin abbreviation (`.mt-`, `.ldb-`, `.chart-`, etc.)
- Use `var(--color-*)` for all colors — never hardcode hex values
- No `!important` unless overriding third-party CSS
- **Tailwind + CSS can coexist** — use Tailwind for layout (`flex`, `gap`, `items-center`), CSS file for complex selectors and animations

### 5. Register the plugin

In `plugins/index.ts`:

```ts
import { myThingPlugin } from './my-thing'

export function registerBuiltinPlugins() {
  // ... existing plugins ...
  BlockRegistry.register(myThingPlugin)
}
```

### 6. Add toolbar entry (if user-creatable)

In `components/Toolbar/Toolbar.tsx`, add to the `tools` array:

```tsx
{
  id: 'my-thing-block' as DrawingSubTool,
  title: 'My Thing (X)', key: 'x',
  icon: <svg>...</svg>,
},
```

And add the `id` to `GROUP_4` (the block tools group).

### 7. Add backend methods (if needed)

```go
// internal/app/my_thing.go
func (a *App) MyThingDoSomething(blockID string) (Result, error) {
    return a.svc.DoSomething(blockID)
}
```

Call from the plugin:
```ts
// In Renderer (has ctx):
const result = await ctx.rpc.call('MyThingDoSomething', blockId)

// In sub-component (no ctx):
import { rpcCall } from '../sdk'
const result = await rpcCall('MyThingDoSomething', blockId)
```

---

## Real Examples from the Codebase

| Plugin | CSS File | Prefix | `memo()` | Capabilities | HeaderExtension |
|---|---|---|---|---|---|
| `markdown` | `markdown.css` | `.markdown-` | ✓ | `editable` | Font size picker |
| `code` | `codeblock.css` | `.code-` | ✓ | `editable` | Language selector |
| `localdb` | `localdb.css` | `.ldb-` | ✗ | — | — |
| `chart` | `chart.css` | `.chart-` | ✗ | — | — |
| `etl` | `etl.css` | `.etl-` | ✗ | — | — |
| `database` | `database.css` | `.db-` | ✗ | `zeroPadding` | — |
| `http` | `http.css` | `.http-` | ✗ | `zeroPadding` | — |
| `image` | — (Tailwind) | — | ✓ | `headerless`, `aspectRatioResize` | — |
| `drawing` | — (Tailwind) | — | ✗ | — | — |

---

## Completion Checklist

Before considering your plugin complete:

- [ ] CSS file created with prefixed class names (or Tailwind-only if minimal)
- [ ] CSS imported at top of `index.tsx`
- [ ] No imports from `../../store` or `../../bridge/wails` (value)
- [ ] Uses `ctx.rpc.call()` for Go backend calls (or `rpcCall()` in sub-components)
- [ ] Uses `ctx.events` for cross-plugin communication
- [ ] Uses `ctx.storage` for content persistence
- [ ] Events prefixed with plugin name (e.g. `mything:updated`)
- [ ] Cleanup functions returned from `useEffect`
- [ ] Registered in `plugins/index.ts`
- [ ] Toolbar entry added (if user-creatable)
- [ ] TypeScript compiles: `npx tsc --noEmit`

---

## PluginContext API Reference

Every `Renderer` receives `ctx: PluginContext` via props. This is the single gateway to host services.

### `ctx.storage`

```ts
ctx.storage.getContent()                  // read block.content (JSON string)
ctx.storage.setContent(json)              // write & persist immediately
ctx.storage.setContentDebounced(json)     // write & persist after 500ms
```

### `ctx.rpc`

```ts
const dbs = await ctx.rpc.call<LocalDatabase[]>('ListLocalDatabases')
const result = await ctx.rpc.call('ExecuteQuery', blockId, connId, sql, limit)
```

Method names match the Go `App` struct methods exactly (PascalCase).

### `ctx.events`

```ts
ctx.events.emit('localdb:changed', { databaseId: id })   // broadcast to other plugins
const unsub = ctx.events.on('etl:job-completed', (p) => { ... })  // listen
const unsub2 = ctx.events.onBackend('db:updated', (p) => { ... }) // Wails events
```

### `ctx.block`

```ts
ctx.block.id       // block UUID
ctx.block.pageId   // owning page UUID
ctx.block.type     // 'chart', 'http', etc.
ctx.block.width    // current width in px
ctx.block.height
```

### `ctx.plugins`

```ts
const api = ctx.plugins.getAPI<{ query(sql: string): Row[] }>('database')
ctx.plugins.isRegistered('chart')
```

### `ctx.blocks`

```ts
ctx.blocks.listByType('localdb')   // blocks on same page
ctx.blocks.listAll()
```

### `ctx.ui`

```ts
ctx.ui.theme()                        // 'light' | 'dark'
ctx.ui.toast('Saved!', 'success')
const path = await ctx.ui.pickFile({ title: 'Import CSV' })
ctx.ui.openUrl(url)                   // open URL in system browser
ctx.ui.getFontSize()                  // read block font size
ctx.ui.setFontSize(size)              // write block font size
```

### `ctx.editor`

```ts
ctx.editor.onClose((cursorLine) => {
  // Called when the Neovim editor closes — scroll to cursor position
})
```

## `rpcCall` (sub-components)

Sub-components that don't receive `ctx` via props import `rpcCall` directly:

```ts
import { rpcCall } from '../sdk'

const rows = await rpcCall<Row[]>('ListLocalDBRows', databaseId)
```

This is used by: `ETLEditor`, `ETLPipeline`, `ETLTransformStep`, `SetupStage` (database).

## Shared Library (`../shared`)

Import from the barrel: `import { useBlockConfig, Select } from '../shared'`

| Export | Description |
|---|---|
| `useBlockConfig` | Parse/persist JSON block config via ctx |
| `useWheelCapture` | Stop wheel propagation on scrollable containers |
| `useEditableTitle` | Double-click-to-edit title pattern |
| `useLoadingState` | Loading/error/ready state machine for async init |
| `Select` | Styled dropdown select component |

## PluginRendererProps

```ts
interface PluginRendererProps {
  block: BlockData         // block data (id, pageId, type, content, x, y, width, height, filePath)
  isEditing: boolean       // true when Neovim editor is mounted
  isSelected: boolean      // true when the block is selected on canvas
  ctx: PluginContext        // the SDK context — single gateway to host services
}
```

## PluginCapabilities

```ts
interface PluginCapabilities {
  editable?: boolean            // mount Neovim on edit, show Edit + Link-file buttons
  aspectRatioResize?: boolean   // lock aspect ratio during resize
  smallBorderRadius?: boolean   // use border-radius-sm instead of md
  zeroPadding?: boolean         // remove default content padding
  headerless?: boolean          // no header, no shadow (e.g. image block)
}
```

## BlockPlugin Interface

```ts
interface BlockPlugin {
  type: string
  label: string
  Icon: ComponentType<{ size?: number }>
  defaultSize: { width: number; height: number }
  headerLabel?: string
  capabilities?: PluginCapabilities
  Renderer: ComponentType<PluginRendererProps>
  HeaderExtension?: ComponentType<{ blockId: string; ctx: PluginContext }>
  onInit?(ctx: PluginContext): (() => void) | void
  onBlockCreate?(ctx: PluginContext): Promise<void> | void
  publicAPI?: (ctx: PluginContext) => Record<string, (...args: any[]) => any>
  ToolbarExtension?: ComponentType<{ ctx: PluginContext }>
  contextMenuItems?: (ctx: PluginContext) => ContextMenuItem[]
  shortcuts?: ShortcutDef[]
}
```
