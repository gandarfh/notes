.PHONY: dev build install uninstall clean test

# Run in development mode with hot reload
dev:
	wails dev

# Build the macOS .app bundle
build:
	wails build

# Build standalone CLI binary and install to ~/.local/bin/notes
# After this, "notes" opens the app and "notes --mcp" runs the MCP server
install: build
	@mkdir -p $(HOME)/.local/bin
	@echo "Installing notes to $(HOME)/.local/bin/notes..."
	cp build/bin/notes.app/Contents/MacOS/notes $(HOME)/.local/bin/notes
	codesign --force --sign - $(HOME)/.local/bin/notes
	@echo "Done. Run 'notes' to open the app or 'notes --mcp' for the MCP server."
	@echo "Make sure $(HOME)/.local/bin is in your PATH."

# Remove the installed binary
uninstall:
	rm -f $(HOME)/.local/bin/notes
	@echo "Removed $(HOME)/.local/bin/notes"

# Run Go tests with coverage table
test:
	@./scripts/test-coverage.sh

# Clean build artifacts
clean:
	rm -rf build/bin/notes.app build/bin/notes-mcp
