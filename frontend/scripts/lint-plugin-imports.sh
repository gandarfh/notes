#!/bin/bash
# ═══════════════════════════════════════════════════════════
# lint-plugin-imports.sh — Ensures plugins don't import forbidden modules
# ═══════════════════════════════════════════════════════════
#
# Usage:  ./scripts/lint-plugin-imports.sh
# Exit 0: clean, Exit 1: violations found
#
# Runs from frontend/ directory.

set -euo pipefail

PLUGINS_DIR="src/plugins"
EXIT_CODE=0

echo "🔍 Checking plugin import rules…"
echo ""

# ── Rule 1: No imports from bridge/wails (value or type) ───
VIOLATIONS=$(grep -rn "from '../../bridge/wails'" "$PLUGINS_DIR" --include='*.ts' --include='*.tsx' 2>/dev/null || true)
if [ -n "$VIOLATIONS" ]; then
    echo "❌ RULE VIOLATION: Plugins must not import from ../../bridge/wails"
    echo "   Use local types.ts for types, and ctx.rpc.call() or rpcCall() for API calls."
    echo "$VIOLATIONS" | while read -r line; do echo "   $line"; done
    echo ""
    EXIT_CODE=1
fi

# ── Rule 2: No useAppStore imports ──────────────────────────
VIOLATIONS=$(grep -rn "from '../../store'" "$PLUGINS_DIR" --include='*.ts' --include='*.tsx' 2>/dev/null || true)
if [ -n "$VIOLATIONS" ]; then
    echo "❌ RULE VIOLATION: Plugins must not import from ../../store"
    echo "   Use ctx.storage or ctx.rpc instead."
    echo "$VIOLATIONS" | while read -r line; do echo "   $line"; done
    echo ""
    EXIT_CODE=1
fi

# ── Rule 3: No window.runtime access (skip sdk/ which is the bridge) ──
VIOLATIONS=$(grep -rn "window\.runtime\." "$PLUGINS_DIR" --include='*.ts' --include='*.tsx' \
    --exclude-dir="sdk" --exclude-dir="shared" 2>/dev/null || true)
if [ -n "$VIOLATIONS" ]; then
    echo "❌ RULE VIOLATION: Plugins must not use window.runtime"
    echo "   Use ctx.events.emit() or ctx.events.onBackend() instead."
    echo "$VIOLATIONS" | while read -r line; do echo "   $line"; done
    echo ""
    EXIT_CODE=1
fi

# ── Rule 4: No cross-plugin imports ────────────────────────
# Skip sdk/ and shared/ (those are allowed), check for ../otherPlugin/ patterns
for PLUGIN_DIR in "$PLUGINS_DIR"/*/; do
    PLUGIN_NAME=$(basename "$PLUGIN_DIR")
    # Skip sdk and shared directories
    [ "$PLUGIN_NAME" = "sdk" ] && continue
    [ "$PLUGIN_NAME" = "shared" ] && continue

    CROSS_IMPORTS=$(grep -rn "from '\.\./[a-z]" "$PLUGIN_DIR" --include='*.ts' --include='*.tsx' 2>/dev/null | \
        grep -v "from '../sdk'" | \
        grep -v "from '../shared" | \
        grep -v "from '../types'" || true)

    if [ -n "$CROSS_IMPORTS" ]; then
        echo "❌ RULE VIOLATION: $PLUGIN_NAME imports from another plugin"
        echo "   Move shared code to plugins/shared/ instead."
        echo "$CROSS_IMPORTS" | while read -r line; do echo "   $line"; done
        echo ""
        EXIT_CODE=1
    fi
done

# ── Rule 5: No onEvent imports from bridge ──────────────────
VIOLATIONS=$(grep -rn "import.*onEvent.*from '../../bridge" "$PLUGINS_DIR" --include='*.ts' --include='*.tsx' 2>/dev/null || true)
if [ -n "$VIOLATIONS" ]; then
    echo "❌ RULE VIOLATION: Plugins must not import onEvent from bridge"
    echo "   Use ctx.events.on() or ctx.events.onBackend() instead."
    echo "$VIOLATIONS" | while read -r line; do echo "   $line"; done
    echo ""
    EXIT_CODE=1
fi

if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ All plugin import rules pass!"
else
    echo "──────────────────────────────────────"
    echo "Fix the violations above. See PLUGIN_SDK.md for the import rules."
fi

exit $EXIT_CODE
