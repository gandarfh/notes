# Notes

A desktop canvas-based note-taking application built with [Wails](https://wails.io) (Go + React/TypeScript). Notes combines a freeform drawing canvas with a rich plugin system and a built-in **MCP server**, giving you a spatial workspace where markdown documents, database queries, charts, ETL pipelines, and drawings coexist on an infinite canvas — and AI agents can interact with it all.

---

## Demo

<!-- TODO: Add demo GIF -->

---

## Screenshots

<!-- TODO: Add screenshots -->

### Canvas & Blocks

### Charts & Pipelines

### Drawing & Diagrams

### ETL & LocalDB

### MCP Server & AI Agent

---

## Features

### Canvas

- Infinite pan-and-zoom canvas with viewport controls
- Freeform drawing with clean and sketchy rendering styles
- Shape primitives: rectangles, ellipses, diamonds, orthogonal arrows
- Text elements with customizable font, size, weight, and alignment
- Style panel for stroke, fill, background, arrow heads, and border radius
- Multi-select, align, reorder, opacity, and lock controls
- Undo tree with full state snapshots and branch visualization

### Block Plugins

Blocks are extensible content units on the canvas, powered by a Plugin SDK with a shared runtime, event bus, and RPC bridge.

- **Markdown** — GitHub-flavored markdown with syntax highlighting, task lists, tables, and scalable typography. Embedded Neovim editing via PTY integration. Per-block font size control.
- **Database** — Connect to PostgreSQL, MySQL, MongoDB, or SQLite. Execute queries with paginated results, inline cell editing, row deletion, and schema introspection.
- **LocalDB** — Embedded SQLite databases scoped per page. Schema editor, data grid with inline editing, and inter-plugin queryable via events.
- **Chart** — Interactive charts (bar, line, area, pie, scatter, radar, number) powered by Recharts. Connects to LocalDB with **data pipeline stages** — chain filters, group-by aggregations, computed columns, sorting, pivots, date extraction, percentage calculations, and cross-database joins before visualization. Full color customization per series.
- **ETL** — Extract-Transform-Load pipelines. Pull data from HTTP APIs, databases, CSV, or JSON files. Apply transforms (rename, filter, compute, format, type cast, string ops, math, flattening) and load into LocalDB tables. Cron scheduling support.
- **HTTP** — REST client block for sending HTTP requests (GET, POST, PUT, DELETE, PATCH) with headers, body editor, and formatted response viewer.
- **Code** — Syntax-highlighted code blocks with language selection via CodeMirror.
- **Image** — Drag-and-drop or paste image embedding with persistent file-backed storage.
- **Drawing** — Inline drawing block rendered on the canvas.

### MCP Server (Model Context Protocol)

Notes exposes a full **MCP server** so AI agents (Claude, Gemini, etc.) can read and manipulate your workspace programmatically.

- **60+ tools** across navigation, blocks, markdown, code, charts, LocalDB, drawing, database, ETL, and HTTP
- **Standalone mode** — run as a headless `stdio` MCP server (`notes --mcp`) without the GUI, using SQLite-based IPC for approval signals
- **Human-in-the-loop approval** — destructive operations (delete, overwrite, write queries) require user approval via an in-app dialog or cross-process SQLite polling
- **Resources** — expose page contents, block details, and database schemas as MCP resources
- **Prompts** — guided workflows for common tasks:
  - `create_dashboard` — multi-block dashboard with title, LocalDB, sample data, and chart
  - `document_api` — structured API documentation with HTTP blocks and code samples
  - `data_pipeline` — ETL → LocalDB → Chart pipeline setup
  - `system_diagram` — architecture diagrams with shapes, arrows, and layout
- **Page watcher** — polls for external changes (from standalone MCP or other processes) and auto-refreshes the frontend via Wails events
- **Auto-layout engine** — intelligent block placement for AI-created content

### Navigation

- Notebook and page hierarchy with breadcrumb navigation
- Command palette (Cmd+K) for quick access to notebooks, pages, and actions
- Sidebar for notebook and page management
- Toast notification system

### Neovim Integration

- Blocks open in an embedded Neovim terminal for editing
- Full PTY support with xterm.js rendering
- Scroll-to-line on editor open, cursor position sync on close

---

## Architecture

```
notes/
  main.go                      # Wails app entry point (+ --mcp flag for standalone mode)
  internal/
    app/                       # Wails-bound application layer (RPC surface)
      mcp_standalone.go        # Headless MCP server entry point
      page_watcher.go          # Polls DB for external changes, emits refresh events
      etl_adapters.go          # ETL source adapters (database, HTTP block resolution)
    domain/                    # Core types: Block, Notebook, Page, Connection
    service/                   # Business logic services (block, notebook, database, ETL, localdb)
    storage/                   # SQLite-backed persistence layer + undo tree
    dbclient/                  # Multi-driver database connector (Postgres, MySQL, MongoDB, SQLite)
    etl/                       # ETL sync engine: sources, transforms, destination
      sources/                 # Source drivers: HTTP, database, CSV, JSON
    mcp/                       # MCP server implementation
      server.go                # Server setup, tool registration, lifecycle
      approval.go              # Human-in-the-loop approval queue (channel + SQLite modes)
      layout.go                # Auto-layout engine for AI-created blocks
      prompts.go               # Guided prompts for dashboards, API docs, diagrams
      resources.go             # MCP resource providers
      tools_*.go               # Tool handlers (navigation, block, markdown, chart, localdb, drawing, database, etl, http, code, plugin)
    neovim/                    # Neovim process management
    terminal/                  # PTY allocation and management
    secret/                    # Credential storage
    plugins/
      drawing/                 # Shared Go drawing engine (native + WASM via TinyGo)
    wasm/
      drawing/                 # TinyGo WASM entry point for frontend Web Worker
  frontend/
    src/
      App.tsx                  # Root layout with header, canvas, and panels
      components/              # UI: Canvas, Toolbar, StylePanel, Breadcrumb, CommandPalette, UndoPanel, Toast
      plugins/                 # Block plugins (markdown, database, localdb, chart, etl, http, code, image, drawing)
        sdk/                   # Plugin SDK — types, context factory, event bus, RPC proxy
          runtime/             # PluginContext factory, event bus internals, rpcProxy
        shared/                # Cross-plugin hooks & components (barrel export)
        index.ts               # Plugin registration (BlockRegistry)
      drawing/                 # Drawing engine: Web Worker proxy, canvas renderer, hit testing, handlers
      input/                   # Layered input manager (global shortcuts, drawing tools, block editing)
      store/                   # Zustand state management (canvas, notebook, drawing, connection, toast slices)
      bridge/                  # Type-safe Wails Go bindings wrapper
        api/                   # Namespaced API modules
      styles/                  # Global CSS (theme tokens, fonts, base resets, third-party overrides)
      hooks/                   # Shared React hooks
```

### Backend

Go with Wails v2. Three-layer architecture: **app** (Wails bindings / RPC surface) → **service** (business logic) → **storage** (SQLite persistence). Multi-database client supporting Postgres, MySQL, MongoDB, and SQLite. ETL engine with pluggable source drivers (HTTP, database, CSV, JSON), transform pipeline, and LocalDB destination. Built-in MCP server with 60+ tools, human-in-the-loop approval, and standalone `stdio` mode. PTY-based terminal management for Neovim integration.

### Frontend

React 18 with TypeScript. Zustand for state management with fine-grained slices. Plugin SDK providing each block with an isolated `PluginContext` (RPC proxy, event bus, store access). Canvas2D rendering via Web Worker with OffscreenCanvas and WASM-powered shape engine. Chart plugin with data pipeline stages (filter, group, sort, pivot, compute, join). Tailwind CSS 4 alongside colocated component CSS. Vite for bundling.

### WASM Drawing Engine

The drawing engine is a shared Go package (`internal/plugins/drawing/`) compiled to WASM via TinyGo for the frontend and used natively by the MCP server tools. The frontend loads `drawing.wasm` in a dedicated Web Worker with two communication protocols:

- **Binary Float64Array** (hot-path, 60fps) — hit testing, orthogonal routing, sketchy shape rendering
- **JSON** (cold-path) — shape listing, anchor computation

Rendering uses a **static cache layer**: elements are drawn once into an OffscreenCanvas and only redrawn when elements change, with diff-based state transfer (FNV-1a hashing) to minimize structured clone overhead between main thread and worker.

### Plugin System

All block plugins implement a common `BlockPlugin` interface and register via `BlockRegistry`. Each plugin receives a `PluginContext` at render time, providing:

- **`ctx.rpc`** — Type-safe calls to Go backend methods
- **`ctx.events`** — Inter-plugin event bus (`emit` / `on` / `onBackend`)
- **`ctx.store`** — Scoped access to app state
- **`ctx.block`** — Block metadata and mutation helpers

See [`PLUGIN_SDK.md`](frontend/src/plugins/sdk/PLUGIN_SDK.md) for the full development guide.

---

## Development

### Prerequisites

- [Go 1.24+](https://go.dev)
- [Node.js 18+](https://nodejs.org)
- [Wails CLI v2](https://wails.io/docs/gettingstarted/installation)

### Setup

```bash
# Install Wails CLI
go install github.com/wailsapp/wails/v2/cmd/wails@latest

# Install frontend dependencies
cd frontend && npm install && cd ..
```

### Run

```bash
make dev
```

This starts the Go backend and a Vite dev server with hot reload. A browser dev server is also available at `http://localhost:34115`.

### Build & Install

```bash
# Build the macOS .app bundle
make build

# Build and install the CLI to ~/.local/bin/notes
make install
```

After `make install`, the `notes` command is available globally (make sure `~/.local/bin` is in your PATH):

```bash
notes          # Opens the GUI app
notes --mcp    # Runs the MCP server on stdio (for AI agents)
```

### MCP Configuration

Add to your AI agent's MCP config (e.g. Claude, Gemini):

```json
{
  "mcpServers": {
    "notes": {
      "command": "notes",
      "args": ["--mcp"]
    }
  }
}
```

### Verification

```bash
# Frontend type check
cd frontend && npx tsc --noEmit

# Go tests
go test ./...

# Go build
go build ./...
```

---

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for code conventions, CSS rules, store guidelines, and plugin development checklist.

---

## License

MIT
