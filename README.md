# Notes

A desktop canvas-based note-taking application built with [Wails](https://wails.io) (Go + React/TypeScript). Notes combines a freeform drawing canvas with a rich plugin system, giving you a spatial workspace where markdown documents, database queries, charts, ETL pipelines, and drawings coexist on an infinite canvas.

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
- **Chart** — Interactive charts (bar, line, pie, area, scatter, radar) powered by Recharts. Connects to LocalDB as a data source with column mapping, sorting, date grouping, and color customization.
- **ETL** — Extract-Transform-Load pipelines. Pull data from HTTP APIs, databases, CSV, or JSON files. Apply transforms (rename, filter, compute, format) and load into LocalDB tables. Cron scheduling support.
- **HTTP** — REST client block for sending HTTP requests (GET, POST, PUT, DELETE, PATCH) with headers, body editor, and formatted response viewer.
- **Code** — Syntax-highlighted code blocks with language selection via CodeMirror.
- **Image** — Drag-and-drop or file picker image embedding.
- **Drawing** — Inline drawing block rendered on the canvas.

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
  main.go                      # Wails app entry point
  internal/
    app/                       # Wails-bound application layer (RPC surface)
    domain/                    # Core types: Block, Notebook, Page, Connection
    service/                   # Business logic services (block, notebook, database, ETL, localdb)
    storage/                   # SQLite-backed persistence layer + undo tree
    dbclient/                  # Multi-driver database connector (Postgres, MySQL, MongoDB, SQLite)
    etl/                       # ETL sync engine: sources, transforms, destination
      sources/                 # Source drivers: HTTP, database, CSV, JSON
    neovim/                    # Neovim process management
    terminal/                  # PTY allocation and management
    secret/                    # Credential storage
    plugins/                   # Backend plugin registry
  frontend/
    src/
      App.tsx                  # Root layout with header, canvas, and panels
      components/              # UI: Canvas, Toolbar, StylePanel, Breadcrumb, CommandPalette, UndoPanel, Toast
      plugins/                 # Block plugins (markdown, database, localdb, chart, etl, http, code, image, drawing)
        sdk/                   # Plugin SDK — types, context factory, event bus, RPC proxy
          runtime/             # PluginContext factory, event bus internals, rpcProxy
        shared/                # Cross-plugin hooks & components (barrel export)
        index.ts               # Plugin registration (BlockRegistry)
      drawing/                 # Shape rendering, hit testing, sketchy style engine
      input/                   # Layered input manager (global shortcuts, drawing tools, block editing)
      store/                   # Zustand state management (canvas, notebook, drawing, connection, toast slices)
      bridge/                  # Type-safe Wails Go bindings wrapper
        api/                   # Namespaced API modules
      styles/                  # Global CSS (theme tokens, fonts, base resets, third-party overrides)
      hooks/                   # Shared React hooks
```

### Backend

Go with Wails v2. Three-layer architecture: **app** (Wails bindings / RPC surface) → **service** (business logic) → **storage** (SQLite persistence). Multi-database client supporting Postgres, MySQL, MongoDB, and SQLite. ETL engine with pluggable source drivers (HTTP, database, CSV, JSON), transform pipeline, and LocalDB destination. PTY-based terminal management for Neovim integration.

### Frontend

React 18 with TypeScript. Zustand for state management with fine-grained slices. Plugin SDK providing each block with an isolated `PluginContext` (RPC proxy, event bus, store access). Custom canvas renderer with SVG-based drawing. Tailwind CSS 4 alongside colocated component CSS. Vite for bundling.

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
wails dev
```

This starts the Go backend and a Vite dev server with hot reload. A browser dev server is also available at `http://localhost:34115`.

### Build

```bash
wails build
```

Produces a native macOS `.app` bundle in `build/bin/`.

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
