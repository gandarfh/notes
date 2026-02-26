# Plugin SDK

> Everything a plugin can import from `../sdk` and `../shared`.

## Rules

1. **Import only from** `../sdk`, `../shared`, and your own plugin directory
2. **Never import** `../../store`, `../../bridge/wails` (value imports), another plugin's directory, or `window.go` / `window.runtime`
3. **Type-only imports** from `../../bridge/wails` are allowed (they vanish at compile time)

## PluginContext

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
```

## `rpcCall` (sub-components)

Sub-components that don't receive `ctx` via props can import `rpcCall` directly:

```ts
import { rpcCall } from '../sdk'

const rows = await rpcCall<Row[]>('ListLocalDBRows', databaseId)
```

## Shared Library (`../shared`)

| Export | Path | Description |
|---|---|---|
| `useBlockConfig` | `shared/hooks/useBlockConfig` | Parse/persist JSON block config via ctx |
| `useWheelCapture` | `shared/hooks/useWheelCapture` | Stop wheel propagation on scrollable containers |
| `useEditableTitle` | `shared/hooks/useEditableTitle` | Double-click-to-edit title pattern |
| `Select` | `shared/components/Select` | Styled dropdown select component |

## BlockPlugin Interface

```ts
export interface BlockPlugin {
    type: string                                       // unique block type key
    label: string                                      // toolbar display name
    Icon: ComponentType<{ size?: number }>              // toolbar icon
    defaultSize: { width: number; height: number }     // initial block size
    headerLabel?: string                               // block header label
    Renderer: ComponentType<PluginRendererProps>        // main component

    // Optional lifecycle
    onInit?(ctx: PluginContext): (() => void) | void
    onBlockCreate?(ctx: PluginContext): Promise<void> | void

    // Optional extensions
    publicAPI?: (ctx: PluginContext) => Record<string, Function>
    ToolbarExtension?: ComponentType<{ ctx: PluginContext }>
    contextMenuItems?: (ctx: PluginContext) => ContextMenuItem[]
    shortcuts?: ShortcutDef[]
}
```

## CSS

Each plugin owns its CSS file imported at the top of `index.tsx`:

```ts
import './chart.css'
```

Use the plugin prefix for all class names (e.g. `.chart-`, `.etl-`, `.ldb-`, `.http-`, `.db-`).
