package terminal

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/creack/pty"
)

// Manager handles a PTY session for running Neovim embedded in the app.
type Manager struct {
	mu      sync.Mutex
	ptmx    *os.File
	cmd     *exec.Cmd
	onData  func(data []byte)
	onExit  func(exitLine int)
	running bool
	editor  string
	// Store pending size for when OpenFile is called
	pendingCols uint16
	pendingRows uint16
	cursorFile  string // temp file where Neovim writes cursor position
}

// New creates a new terminal manager.
func New(onData func(data []byte), onExit func(exitLine int)) *Manager {
	editor := os.Getenv("EDITOR")
	if editor == "" {
		editor = "nvim"
	}
	cursorFile := filepath.Join(os.TempDir(), "notes_nvim_cursor")
	return &Manager{
		onData:      onData,
		onExit:      onExit,
		editor:      editor,
		pendingCols: 80,
		pendingRows: 24,
		cursorFile:  cursorFile,
	}
}

// OpenFile starts the editor on the given file path at the specified line.
// If lineNumber <= 0, it opens at the beginning.
// If a session is already running, it closes it first.
func (m *Manager) OpenFile(filePath string, lineNumber int) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Close existing session
	if m.running {
		m.closeInternal()
	}

	// Remove any old cursor file
	os.Remove(m.cursorFile)

	// Build Neovim command: open at line, add VimLeave autocmd to save cursor pos
	args := []string{}
	if lineNumber > 0 {
		args = append(args, fmt.Sprintf("+%d", lineNumber))
	}
	args = append(args,
		"-c", fmt.Sprintf("autocmd VimLeave * call writefile([line('.')], '%s')", m.cursorFile),
		filePath,
	)

	cmd := exec.Command(m.editor, args...)
	cmd.Env = append(os.Environ(),
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
	)

	// Start PTY with the correct initial size so Neovim renders properly
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{
		Cols: m.pendingCols,
		Rows: m.pendingRows,
	})
	if err != nil {
		return fmt.Errorf("start pty: %w", err)
	}

	m.ptmx = ptmx
	m.cmd = cmd
	m.running = true

	// Read PTY output → send to frontend
	go func() {
		buf := make([]byte, 32768)
		for {
			n, err := ptmx.Read(buf)
			if n > 0 {
				data := make([]byte, n)
				copy(data, buf[:n])
				if m.onData != nil {
					m.onData(data)
				}
			}
			if err != nil {
				break
			}
		}

		// Read cursor position from temp file
		exitLine := 0
		if data, err := os.ReadFile(m.cursorFile); err == nil {
			if line, err := strconv.Atoi(strings.TrimSpace(string(data))); err == nil {
				exitLine = line
			}
			os.Remove(m.cursorFile)
		}

		// Process exited
		m.mu.Lock()
		m.running = false
		m.mu.Unlock()
		if m.onExit != nil {
			m.onExit(exitLine)
		}
	}()

	return nil
}

// Write sends input data to the PTY (keystrokes from xterm.js).
func (m *Manager) Write(data string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.running || m.ptmx == nil {
		return fmt.Errorf("no active terminal session")
	}

	_, err := io.WriteString(m.ptmx, data)
	return err
}

// Resize updates the PTY window size.
func (m *Manager) Resize(cols, rows uint16) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Always store for the next OpenFile call
	m.pendingCols = cols
	m.pendingRows = rows

	if !m.running || m.ptmx == nil {
		return nil
	}

	return pty.Setsize(m.ptmx, &pty.Winsize{
		Cols: cols,
		Rows: rows,
	})
}

// IsRunning returns whether a session is active.
func (m *Manager) IsRunning() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.running
}

// Close closes the current PTY session.
func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closeInternal()
}

func (m *Manager) closeInternal() {
	if m.ptmx != nil {
		m.ptmx.Close()
		m.ptmx = nil
	}
	if m.cmd != nil && m.cmd.Process != nil {
		m.cmd.Process.Kill()
		m.cmd.Wait()
		m.cmd = nil
	}
	m.running = false
}
