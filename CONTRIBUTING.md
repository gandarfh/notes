# Contributing Guide

Rules and conventions for the Notes codebase — **derived from how the code actually works today**. Read before writing any new code.

---

## Project Structure

```
notes/
  internal/                  # Go backend (Wails-bound)
    app/                     # App struct — Wails bindings (methods become frontend RPC calls)
    domain/                  # Core types: Block, Notebook, Page, Connection
    service/                 # Business logic services
    storage/                 # SQLite persistence layer
    dbclient/                # Multi-driver DB connector
    etl/                     # ETL sync engine
  frontend/
    src/
      components/            # UI components (Toolbar, Breadcrumb, Canvas, etc.)
      plugins/               # Block plugins (markdown, localdb, chart, etc.)
        sdk/                 # Plugin SDK — types, context, runtime
          runtime/           # PluginContext factory, event bus, rpcProxy
        shared/              # Cross-plugin hooks & components (barrel export)
      drawing/               # Canvas drawing engine (shapes, hit-testing, sketchy style)
      input/                 # Layered input manager (global shortcuts, drawing, editing)
      store/                 # Zustand state management
      bridge/                # Type-safe Wails bindings
        api/                 # Namespaced API modules
      styles/                # Global CSS only (theme, fonts, base, third-party overrides)
```

---

## CSS Rules

### Where CSS lives

| CSS scope | File location | Imported by |
|---|---|---|
| Theme tokens, fonts, base resets | `styles/main.css` | App entry |
| Third-party overrides (CodeMirror, hljs) | `styles/codemirror.css`, `styles/hljs.css` | `@import` in main.css |
| UI components | `components/<Name>/<name>.css` | Component's `.tsx` |
| Plugins | `plugins/<name>/<name>.css` | Plugin's `index.tsx` |

### Rules

1. **No component/plugin CSS in `main.css`** — it holds only theme tokens, fonts, `@layer base` resets, and truly global rules (canvas, cursors, connectors, block containment)
2. **Colocate CSS** next to the component that uses it
3. **Prefix all class names** with the component/plugin abbreviation:
   - Plugins: `.ldb-`, `.chart-`, `.etl-`, `.http-`, `.db-`, `.code-`
   - Components: `.cmd-`, `.sp-`, `.breadcrumb-`, `.toolbar-`, `.toast-`
4. **Use CSS custom properties** (`var(--color-*)`) for all colors — never hardcode hex values
5. **No `!important`** unless overriding third-party libraries (CodeMirror, xterm, hljs)
6. **Small plugins can skip CSS files** — drawing and image plugins use Tailwind utilities directly since they have minimal styling needs

### Tailwind + CSS coexistence

The project mixes Tailwind utilities and plain CSS. This is the actual convention:

- **Tailwind utilities** for layout, spacing, simple visual props (`flex`, `items-center`, `h-full`, `text-text-muted`, `rounded`)
- **CSS file** for complex selectors, pseudo-elements, animations, hover states, conditional styling, and anything that would make className strings unreadable
- **Both in the same component** is fine — see `MarkdownHeaderExtension` which uses Tailwind for small header buttons while `markdown.css` handles the preview

---

## Component Conventions

### Structure

```
components/
  MyComponent/
    MyComponent.tsx     # Component code
    mycomponent.css     # Colocated styles (if needed)
```

### Rules

1. **Import CSS at the top** of the file: `import './mycomponent.css'`
2. **Stop propagation** on interactive panels to prevent canvas drag: `onMouseDown={e => e.stopPropagation()}`
3. **Use `registerModal`** for components with Escape-to-close behavior (see `Breadcrumb.tsx`)
4. **Named exports** — no default exports
5. **`memo()` is optional** — use it for Renderers that benefit from shallow comparison (markdown, code), skip it when props change frequently

---

## Store Rules (Zustand)

1. **Select only what you need**: `useAppStore(s => s.specificField)` — never `useAppStore()`
2. **Fine-grained selectors** — each component should subscribe only to the state it renders
3. **Actions beside state** — actions live in the store slice, not in components
4. **No store imports in plugins** — plugins use `ctx` (PluginContext). Only host components (`components/`) import from `../../store`

---

## Bridge / RPC Rules

1. **Frontend → Go** calls go through `bridge/api/*.ts` modules (for host code) or `ctx.rpc.call()` / `rpcCall()` (for plugins)
2. **Plugins never import** `bridge/` directly — they use:
   - `ctx.rpc.call('MethodName', ...args)` — in the main Renderer
   - `rpcCall('MethodName', ...args)` — in sub-components that don't receive `ctx` (import from `../sdk`)
3. **Type-only imports** from `bridge/wails.ts` are allowed (they vanish at compile time)
4. **Method names** must match the Go `App` struct method exactly (PascalCase)
5. **New API methods**: add to `internal/app/`, update `bridge/api/`, and expose types in `sdk/types.ts`

---

## Event System

| Bus | Scope | Example |
|---|---|---|
| `ctx.events.emit()` / `ctx.events.on()` | Plugin ↔ Plugin | `'localdb:changed'`, `'etl:job-completed'` |
| `ctx.events.onBackend()` | Go → Frontend (Wails runtime events) | `'db:updated'` |
| `pluginBus.emit()` / `pluginBus.on()` | Internal SDK (not for plugins directly) | `'ui:toast'` |

### Rules

1. **Prefix events** with the plugin/domain name: `localdb:`, `etl:`, `chart:`, `block:`
2. **Always unsubscribe** — return the cleanup function from `useEffect`

---

## Plugin Development

See [`frontend/src/plugins/sdk/PLUGIN_SDK.md`](frontend/src/plugins/sdk/PLUGIN_SDK.md) for the full guide + step-by-step walkthrough.

### Quick Checklist

- [ ] Create `plugins/<name>/` directory
- [ ] Create `index.tsx` with `Renderer` component and plugin export
- [ ] Create `<name>.css` with prefixed class names (or use Tailwind if minimal)
- [ ] Import CSS at top of `index.tsx` (if using a CSS file)
- [ ] Register in `plugins/index.ts` via `BlockRegistry.register()`
- [ ] Add toolbar entry in `Toolbar.tsx` (if user-creatable)
- [ ] Add Go methods in `internal/app/` (if backend needed)
- [ ] Expose RPC types in `sdk/types.ts` (if new API surface)

---

## Go Backend Conventions

1. **Layered architecture**: `app/` (Wails bindings) → `service/` (business logic) → `storage/` (SQLite persistence)
2. **`domain/` is pure** — no imports from other internal packages
3. **Error handling** — return errors up, log at the boundary (app layer)
4. **Context propagation** — pass `context.Context` through service methods
5. **No global state** — inject dependencies via struct fields

---

## Verification

Before committing:

```bash
# Frontend type check
cd frontend && npx tsc --noEmit

# Go build
go build ./...

# Full app (dev mode)
wails dev
```
