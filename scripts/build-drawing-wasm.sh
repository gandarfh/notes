#!/bin/bash
# Build the drawing engine WASM module using TinyGo.
# Output: frontend/public/drawing.wasm
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT="$PROJECT_ROOT/frontend/public/drawing.wasm"

echo "Building drawing.wasm with TinyGo..."
tinygo build \
  -o "$OUTPUT" \
  -target wasm \
  -no-debug \
  -opt 2 \
  "$PROJECT_ROOT/pkg/drawing/cmd/wasm/main.go"

SIZE=$(ls -lh "$OUTPUT" | awk '{print $5}')
echo "✅ Built $OUTPUT ($SIZE)"
