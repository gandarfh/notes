---
description: How to add a new block plugin to the Notes app
---

// turbo-all

## Prerequisites

Before starting, read:
- `CONTRIBUTING.md` — project-wide coding guidelines
- `frontend/src/plugins/sdk/PLUGIN_SDK.md` — full plugin SDK reference with real examples

## Steps

### 1. Create plugin directory

Create `frontend/src/plugins/<name>/` with:
- `index.tsx` — Renderer component + plugin export
- `<name>.css` — colocated styles (skip if truly minimal like drawing/image)

### 2. Implement the Renderer

In `index.tsx`:
- Import CSS at the top: `import './<name>.css'`
- Import types from `../sdk`: `import type { BlockPlugin, PluginRendererProps } from '../sdk'`
- **Never** import from `../../store` or `../../bridge/wails` (value imports)
- Destructure all 4 props: `{ block, isEditing, isSelected, ctx }`
- Use `ctx.rpc.call('GoMethod', ...args)` for backend calls
- sub-components that don't receive ctx use `rpcCall` from `../sdk`
- Use `ctx.storage` for persisting JSON content
- Use `ctx.events` for inter-plugin communication (prefix events: `mything:`)
- Add `onMouseDown={e => e.stopPropagation()}` on interactive containers
- Return cleanup functions from all `useEffect`
- `memo()` is optional — use it for content-heavy blocks (markdown, code)

### 3. CSS conventions

- Prefix ALL class names: `.mt-` for "my-thing", `.ldb-` for localdb, etc.
- Use `var(--color-*)` for all colors — no hardcoded hex
- No `!important` unless overriding third-party
- Tailwind utilities are fine for layout — CSS file for complex selectors/animations

### 4. Export the plugin object

```tsx
export const myThingPlugin: BlockPlugin = {
  type: 'my-thing',
  label: 'My Thing',
  Icon: MyThingIcon,
  defaultSize: { width: 400, height: 300 },
  headerLabel: 'THING',
  Renderer: MyThingRenderer,
  capabilities: { ... },  // editable, zeroPadding, headerless, aspectRatioResize, smallBorderRadius
}
```

### 5. Register in plugins/index.ts

```ts
import { myThingPlugin } from './my-thing'
BlockRegistry.register(myThingPlugin)
```

### 6. Add toolbar entry (if user-creatable)

In `components/Toolbar/Toolbar.tsx`:
- Add to `tools` array with `id`, `title`, `key`, `icon`
- Add the `id` to `GROUP_4` (block tools)

### 7. Go backend (if needed)

- Add methods to `internal/app/` (PascalCase, matches RPC call name)
- Call via `ctx.rpc.call('MethodName')` or `rpcCall('MethodName')` from sub-components

### 8. Shared hooks

Use from `../shared` (import from barrel):
- `useBlockConfig` — JSON config persistence
- `useWheelCapture` — capture scroll on scrollable blocks
- `useEditableTitle` — double-click title pattern
- `useLoadingState` — loading/error/ready state machine
- `Select` — styled dropdown component

### 9. Verify

```bash
cd frontend && npx tsc --noEmit
wails dev
```
