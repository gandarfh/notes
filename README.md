# Notes

A desktop canvas-based note-taking application built with [Wails](https://wails.io) (Go + React/TypeScript). Notes combines a freeform drawing canvas with rich content blocks, giving you a spatial workspace where markdown documents, database queries, and drawings coexist on an infinite canvas.

---

## Features

### Canvas

- Infinite pan-and-zoom canvas with viewport controls
- Freeform drawing with both clean and sketchy rendering styles
- Shape primitives: rectangles, ellipses, diamonds, orthogonal arrows
- Text elements with customizable font, size, weight, and alignment
- Style panel for stroke, fill, background, arrow heads, and border radius
- Multi-select, align, reorder, opacity, and lock controls
- Undo tree with full state snapshots and branch visualization

### Block System

- **Markdown** -- Full GitHub-flavored markdown with syntax highlighting, task lists, tables, and scalable typography. Embedded Neovim editing via PTY integration. Per-block font size control.
- **Database** -- Connect to PostgreSQL, MySQL, MongoDB, or SQLite. Execute queries with paginated results, inline cell editing, row deletion, and schema introspection.
- **Image** -- Drag-and-drop or file picker image embedding.

### Navigation

- Notebook and page hierarchy with breadcrumb navigation
- Command palette (Cmd+K) for quick access to notebooks, pages, and actions
- Sidebar for notebook and page management

### Neovim Integration

- Blocks open in an embedded Neovim terminal for editing
- Full PTY support with xterm.js rendering
- Scroll-to-line on editor open, cursor position sync on close

---

## Architecture

```
notes/
  main.go                  # Wails app entry point
  internal/
    app/                   # Wails-bound application service
    domain/                # Core types: Block, Notebook, Page, Connection
    storage/               # SQLite-backed persistence layer
    dbclient/              # Multi-driver database connector (Postgres, MySQL, MongoDB, SQLite)
    neovim/                # Neovim process management
    terminal/              # PTY allocation and management
    secret/                # Credential storage
  frontend/
    src/
      App.tsx              # Root layout with header, canvas, and panels
      components/          # Canvas, Toolbar, StylePanel, Breadcrumb, CommandPalette, UndoPanel
      plugins/             # Block renderers: markdown, database, image, drawing
      drawing/             # Shape rendering, hit testing, sketchy style engine
      input/               # Layered input manager (global shortcuts, drawing tools, block editing)
      store/               # Zustand state management
      bridge/              # Type-safe Wails Go bindings wrapper
```

**Backend** -- Go with Wails v2. SQLite for local persistence. Multi-database client supporting Postgres, MySQL, MongoDB, and SQLite for the database block plugin. PTY-based terminal management for Neovim integration.

**Frontend** -- React 18 with TypeScript. Zustand for state. Custom canvas renderer with SVG-based drawing. Tailwind CSS 4 with a component layer for all UI panels. Vite for bundling.

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

---

## License

MIT
