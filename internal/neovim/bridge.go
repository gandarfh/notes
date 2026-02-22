package neovim

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/fsnotify/fsnotify"
)

// ContentChangedHandler is called when a watched file changes.
type ContentChangedHandler func(blockID string, content string)

// Bridge manages live preview updates by watching files on disk.
// When Neovim saves the file, the watcher fires and sends updated
// content to the frontend for re-rendering.
type Bridge struct {
	watcher  *fsnotify.Watcher
	onChange ContentChangedHandler
	mu       sync.RWMutex
	watching map[string]string // filePath -> blockID
}

// New creates a new Neovim bridge.
func New(onChange ContentChangedHandler) (*Bridge, error) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("create watcher: %w", err)
	}

	b := &Bridge{
		watcher:  watcher,
		onChange: onChange,
		watching: make(map[string]string),
	}

	go b.watchLoop()

	return b, nil
}

// WatchFile starts watching a file for changes.
func (b *Bridge) WatchFile(blockID, filePath string) error {
	absPath, err := filepath.Abs(filePath)
	if err != nil {
		return err
	}

	b.mu.Lock()
	b.watching[absPath] = blockID
	b.mu.Unlock()

	// Watch the directory (fsnotify watches dirs for file events)
	dir := filepath.Dir(absPath)
	return b.watcher.Add(dir)
}

// StopWatching stops watching a file.
func (b *Bridge) StopWatching(blockID string) {
	b.mu.Lock()
	defer b.mu.Unlock()

	for path, id := range b.watching {
		if id == blockID {
			delete(b.watching, path)
			break
		}
	}
}

// Close stops the watcher.
func (b *Bridge) Close() error {
	return b.watcher.Close()
}

func (b *Bridge) watchLoop() {
	for {
		select {
		case event, ok := <-b.watcher.Events:
			if !ok {
				return
			}
			if event.Has(fsnotify.Write) {
				absPath, _ := filepath.Abs(event.Name)
				b.mu.RLock()
				blockID, watched := b.watching[absPath]
				b.mu.RUnlock()

				if watched {
					content, err := os.ReadFile(absPath)
					if err != nil {
						log.Printf("neovim bridge: read file %s: %v", absPath, err)
						continue
					}
					if b.onChange != nil {
						b.onChange(blockID, strings.TrimSpace(string(content)))
					}
				}
			}
		case err, ok := <-b.watcher.Errors:
			if !ok {
				return
			}
			log.Printf("neovim bridge: watcher error: %v", err)
		}
	}
}
