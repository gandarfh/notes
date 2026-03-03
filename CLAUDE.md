# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Notes** is a desktop canvas-based note-taking app built with **Wails v2** (Go backend + React/TypeScript frontend). Features an infinite canvas with block plugins, a shared Go drawing engine compiled to WASM, embedded Neovim via PTY, and a built-in MCP server with 60+ tools for AI agents.

## Commands

```bash
# Development
make dev                              # Wails dev with hot reload (Go + Vite)
make build                            # Build macOS .app bundle
make install                          # Build + install binary to ~/.local/bin/notes
make clean                            # Remove build artifacts

# Frontend verification
cd frontend && npx tsc --noEmit       # TypeScript type-check
cd frontend && npm run lint:plugins   # Check plugin import isolation rules

# Go verification
go test ./...                         # All Go tests
go build ./...                        # Build check

# WASM (only when modifying internal/plugins/drawing/ or internal/wasm/drawing/)
./scripts/build-drawing-wasm.sh       # TinyGo build → frontend/public/drawing.wasm
```

## Architecture

### Backend: Three-Layer Architecture

```
main.go → internal/app/      (Wails-bound RPC surface — thin adapters only)
              ↓
          internal/service/   (business logic, dependency-injected)
              ↓
          internal/storage/   (SQLite persistence, WAL mode)
```

- `internal/domain/` is **pure** — no imports from other internal packages
- All logic lives in `service/`, `app/` methods are thin wrappers
- No global state — dependencies injected via struct fields
- `EventEmitter` interface decouples services from Wails runtime

### Frontend: Plugin Architecture

- **Zustand** store with slices (canvas, notebook, drawing, connection, toast) — always use fine-grained selectors: `useAppStore(s => s.field)`
- **BlockRegistry** singleton — all block types register at startup in `plugins/index.ts`
- **PluginContext** (`ctx`) provides isolated access to RPC, events, storage, UI
- **Plugin isolation enforced**: plugins import only from `../sdk`, `../shared`, and own directory — never from `../../store` or `../../bridge/wails` (checked by `npm run lint:plugins`)
- Host components (`components/`) may import from `store/` and `bridge/`

### WASM Drawing Engine

`internal/plugins/drawing/` is a shared Go package used in two ways:
1. **Natively** by the Go MCP server tools
2. **Compiled to WASM** via TinyGo for the frontend

Frontend loads `drawing.wasm` in a Web Worker. Two communication protocols:
- **Binary Float64Array** (hot-path, 60fps): hit testing, routing, sketch rendering
- **JSON** (cold-path): shape listing, anchor computation

### MCP Server

- Embedded in Wails app, also standalone via `notes --mcp`
- SQLite WAL for cross-process IPC between standalone MCP and Wails app
- Human-in-the-loop approval for destructive operations via `mcp_approvals` table
- Auto-layout engine for AI-created blocks

## Key Conventions

### Go Backend
- Layered: `app/` → `service/` → `storage/`; domain is pure
- Return errors up, log at `app/` boundary
- New API: add method to `internal/app/`, update `bridge/api/`, expose types in `sdk/types.ts`

### Frontend RPC
- Plugins: `ctx.rpc.call('GoMethodName', ...args)` or `rpcCall()` from sub-components
- Host code: `bridge/api/*.ts` modules
- Method names must match Go `App` struct methods exactly (PascalCase)
- Type-only imports from `bridge/wails.ts` are allowed in plugins

### CSS / Styling
- **Tailwind CSS v4** (CSS-native config, no `tailwind.config.js`)
- Theme via CSS custom properties `var(--color-*)` — never hardcode hex
- Colocated CSS files with prefixed class names (e.g., `.ldb-`, `.chart-`, `.cmd-`, `.toolbar-`)
- No `!important` unless overriding third-party CSS
- Tailwind for layout/spacing, CSS files for complex selectors/animations

### Events
- Prefix with domain: `localdb:`, `etl:`, `chart:`, `block:`, `mcp:`
- Always unsubscribe in `useEffect` cleanup

## Plugin Development

Full guide: `frontend/src/plugins/sdk/PLUGIN_SDK.md`

1. Create `plugins/<name>/index.tsx` with `Renderer` + `BlockPlugin` export
2. Create `<name>.css` with prefixed classes (or use Tailwind if minimal)
3. Register in `plugins/index.ts` via `BlockRegistry.register()`
4. Add toolbar entry in `Toolbar.tsx` if user-creatable
5. Add Go methods in `internal/app/` if backend needed

## Key Documentation

- `CONTRIBUTING.md` — Code conventions (CSS, store, bridge/RPC, events, Go)
- `frontend/src/plugins/sdk/PLUGIN_SDK.md` — Plugin SDK guide
- `docs/rfcs/` — Architecture decisions for the WASM drawing engine (001–005)
- `.agents/workflows/create-plugin.md` — Agent workflow for new plugins
