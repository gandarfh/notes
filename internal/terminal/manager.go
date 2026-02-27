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
	shellPath   string // user's full login shell PATH (resolved once)
}

// resolveEditor finds the absolute path for the editor binary.
// macOS GUI apps (like Wails) don't inherit the shell's $PATH,
// so we probe common installation paths as a fallback.
func resolveEditor(name string) string {
	// If it's already an absolute path, use it directly
	if filepath.IsAbs(name) {
		return name
	}
	// Try the process PATH first
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	// Probe common macOS paths
	candidates := []string{
		filepath.Join("/opt/homebrew/bin", name),          // Apple Silicon Homebrew
		filepath.Join("/usr/local/bin", name),             // Intel Homebrew / manual installs
		filepath.Join("/run/current-system/sw/bin", name), // NixOS
	}
	// Also check the user's shell PATH via login shell
	if home, err := os.UserHomeDir(); err == nil {
		candidates = append(candidates,
			filepath.Join(home, ".local/bin", name),
			filepath.Join(home, ".nix-profile/bin", name),
		)
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	// Last resort: return the name as-is and let exec.Command fail with a clear error
	return name
}

// resolveShellPath gets the user's full login shell PATH.
// macOS GUI apps (Wails) inherit a minimal PATH; this runs the user's
// login shell to capture the complete PATH so Neovim child processes
// (LSPs, formatters, etc.) can find installed tools.
func resolveShellPath() string {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
	}
	out, err := exec.Command(shell, "-lc", "echo $PATH").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// New creates a new terminal manager.
func New(onData func(data []byte), onExit func(exitLine int)) *Manager {
	editor := os.Getenv("EDITOR")
	if editor == "" {
		editor = "nvim"
	}
	editor = resolveEditor(editor)
	cursorFile := filepath.Join(os.TempDir(), "notes_nvim_cursor")
	return &Manager{
		onData:      onData,
		onExit:      onExit,
		editor:      editor,
		pendingCols: 80,
		pendingRows: 24,
		cursorFile:  cursorFile,
		shellPath:   resolveShellPath(),
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

	// Build environment: start from current env, override PATH with the
	// user's full login shell PATH so child processes find installed tools.
	env := os.Environ()
	if m.shellPath != "" {
		// Replace existing PATH entry
		replaced := false
		for i, e := range env {
			if strings.HasPrefix(e, "PATH=") {
				env[i] = "PATH=" + m.shellPath
				replaced = true
				break
			}
		}
		if !replaced {
			env = append(env, "PATH="+m.shellPath)
		}
	}
	env = append(env,
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
	)
	cmd.Env = env

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
