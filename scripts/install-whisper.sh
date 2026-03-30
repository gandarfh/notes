#!/bin/bash
set -euo pipefail

MODEL_DIR="$HOME/.local/share/whisper"
MODEL_FILE="$MODEL_DIR/ggml-large-v3.bin"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin"

echo "=== Instalando whisper.cpp para Meeting Capture ==="

# 1. Instalar whisper.cpp via Homebrew
if command -v whisper-cli &>/dev/null; then
    echo "✓ whisper-cli já instalado: $(which whisper-cli)"
else
    echo "→ Instalando whisper.cpp via Homebrew..."
    brew install whisper-cpp
    echo "✓ whisper-cli instalado"
fi

# 2. Baixar modelo large-v3
if [ -f "$MODEL_FILE" ]; then
    echo "✓ Modelo já existe: $MODEL_FILE"
else
    echo "→ Baixando modelo large-v3 (~3 GB)..."
    mkdir -p "$MODEL_DIR"
    curl -L --progress-bar -o "$MODEL_FILE" "$MODEL_URL"
    echo "✓ Modelo salvo em $MODEL_FILE"
fi

# 3. Verificar
echo ""
echo "=== Verificação ==="
whisper-cli --version 2>/dev/null || whisper-cli --help 2>&1 | head -1
echo "Modelo: $(du -h "$MODEL_FILE" | cut -f1) em $MODEL_FILE"
echo ""
echo "✓ Pronto para usar com Meeting Capture"
