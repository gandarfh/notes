#!/usr/bin/env bash
set -euo pipefail

COVERFILE="coverage.out"
PACKAGES="./internal/..."

# Colors
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

# ── Helpers ───────────────────────────────────────────────

color_for_cov() {
    local int_cov=${1%.*}
    if (( int_cov >= 80 )); then echo -n "$GREEN"
    elif (( int_cov >= 50 )); then echo -n "$YELLOW"
    else echo -n "$RED"
    fi
}

BAR_WIDTH=20

bar_for_cov() {
    local int_cov=${1%.*}
    local filled=$(( int_cov * BAR_WIDTH / 100 ))
    local empty=$(( BAR_WIDTH - filled ))
    local bar=""
    for ((i=0; i<filled; i++)); do bar+="█"; done
    for ((i=0; i<empty; i++)); do bar+="░"; done
    echo -n "$bar"
}

print_table_header() {
    echo -e "${BOLD}┌──────────────────────────────────┬─────────┬──────────────────────┐${RESET}"
    echo -e "${BOLD}│ ${1}$(printf '%*s' $((33 - ${#1})) '')│ Cover % │ Bar                  │${RESET}"
    echo -e "${BOLD}├──────────────────────────────────┼─────────┼──────────────────────┤${RESET}"
}

print_table_row() {
    local name="$1" cov="$2"
    local color; color=$(color_for_cov "$cov")
    local bar; bar=$(bar_for_cov "$cov")
    printf "│ %-32s │ ${color}%6s%%${RESET} │ ${color}%s${RESET} │\n" "$name" "$cov" "$bar"
}

print_table_total() {
    local cov="$1"
    local color; color=$(color_for_cov "$cov")
    local bar; bar=$(bar_for_cov "$cov")
    echo -e "${BOLD}├──────────────────────────────────┼─────────┼──────────────────────┤${RESET}"
    printf "│ ${BOLD}%-32s${RESET} │ ${color}${BOLD}%6s%%${RESET} │ ${color}%s${RESET} │\n" "TOTAL" "$cov" "$bar"
    echo -e "${BOLD}└──────────────────────────────────┴─────────┴──────────────────────┘${RESET}"
}

# ── Run frontend tests with coverage ─────────────────────

echo -e "${BOLD}Running frontend tests...${RESET}"
echo ""

FRONT_OUTPUT=$(cd frontend && npx vitest run --coverage 2>&1)
FRONT_EXIT=$?

if [ "$FRONT_EXIT" -ne 0 ]; then
    echo -e "${RED}Frontend tests failed:${RESET}"
    echo "$FRONT_OUTPUT"
    exit 1
fi

# Extract test count
FRONT_CLEAN=$(echo "$FRONT_OUTPUT" | sed 's/\x1b\[[0-9;]*m//g')
FRONT_TESTS=$(echo "$FRONT_CLEAN" | grep 'Tests' | grep -oE '[0-9]+ passed' | head -1 || echo "0 passed")

# Parse coverage JSON → table
FRONT_COV_FILE="frontend/coverage/coverage-summary.json"
if [ -f "$FRONT_COV_FILE" ]; then
    # Extract per-directory coverage using python (available on macOS)
    FRONT_TABLE=$(python3 -c "
import json, sys, os
with open('$FRONT_COV_FILE') as f:
    data = json.load(f)

# Group files by directory (relative to src/)
dirs = {}
base = os.path.abspath('frontend/src') + '/'
for path, cov in data.items():
    if path == 'total':
        continue
    rel = path.replace(base, '')
    d = os.path.dirname(rel) or rel
    # Group to top-level dir (e.g. drawing/handlers → drawing)
    top = d.split('/')[0]
    if top not in dirs:
        dirs[top] = {'stmts': 0, 'covered': 0}
    dirs[top]['stmts'] += cov['statements']['total']
    dirs[top]['covered'] += cov['statements']['covered']

# Sort by coverage descending
items = []
for d, v in dirs.items():
    pct = (v['covered'] / v['stmts'] * 100) if v['stmts'] > 0 else 0
    items.append((d, round(pct, 1)))
items.sort(key=lambda x: -x[1])

total = data['total']['statements']
total_pct = round(total['pct'], 1)

for name, pct in items:
    print(f'{name}\t{pct}')
print(f'__TOTAL__\t{total_pct}')
")

    print_table_header "Frontend"

    FRONT_TOTAL_COV=""
    while IFS=$'\t' read -r name cov; do
        if [ "$name" = "__TOTAL__" ]; then
            FRONT_TOTAL_COV="$cov"
        else
            print_table_row "$name" "$cov"
        fi
    done <<< "$FRONT_TABLE"

    print_table_total "${FRONT_TOTAL_COV:-0}"
else
    echo -e "${YELLOW}No frontend coverage data found${RESET}"
fi

echo ""
echo -e "${BOLD}Frontend: ${GREEN}${FRONT_TESTS}${RESET}"
echo ""

# ── Run Go tests ──────────────────────────────────────────

echo -e "${BOLD}Running Go tests...${RESET}"
echo ""

TEST_OUTPUT=$(go test $PACKAGES -coverprofile="$COVERFILE" -count=1 -timeout 120s 2>&1)
TEST_EXIT=$?

# Count results
PASSED=$(echo "$TEST_OUTPUT" | grep -c "^ok" || true)
FAILED=$(echo "$TEST_OUTPUT" | grep -c "^FAIL" || true)
TOTAL_TESTS=$(go test $PACKAGES -v -count=1 -timeout 120s 2>&1 | grep -c "^--- PASS" || true)

# ── Parse Go coverage per package ─────────────────────────

declare -a PKG_NAMES=()
declare -a PKG_COVS=()

while IFS= read -r line; do
    if [[ $line =~ ^ok[[:space:]]+([^[:space:]]+)[[:space:]]+.*coverage:\ ([0-9.]+)% ]]; then
        PKG_NAMES+=("${BASH_REMATCH[1]}")
        PKG_COVS+=("${BASH_REMATCH[2]}")
    elif [[ $line =~ ^[[:space:]]+([^[:space:]]+)[[:space:]]+coverage:\ ([0-9.]+)% ]]; then
        PKG_NAMES+=("${BASH_REMATCH[1]}")
        PKG_COVS+=("${BASH_REMATCH[2]}")
    fi
done <<< "$TEST_OUTPUT"

TOTAL_COV=$(go tool cover -func="$COVERFILE" 2>/dev/null | tail -1 | awk '{print $NF}' | tr -d '%')

# Sort by coverage descending
indices=()
for i in "${!PKG_NAMES[@]}"; do indices+=("$i"); done

for ((i = 0; i < ${#indices[@]}; i++)); do
    for ((j = i + 1; j < ${#indices[@]}; j++)); do
        a=${PKG_COVS[${indices[$i]}]}
        b=${PKG_COVS[${indices[$j]}]}
        if (( $(echo "$b > $a" | bc -l) )); then
            tmp=${indices[$i]}
            indices[$i]=${indices[$j]}
            indices[$j]=$tmp
        fi
    done
done

print_table_header "Go Package"

for idx in "${indices[@]}"; do
    pkg="${PKG_NAMES[$idx]}"
    cov="${PKG_COVS[$idx]}"
    short="${pkg#notes/internal/}"
    print_table_row "$short" "$cov"
done

print_table_total "$TOTAL_COV"

# Summary
echo ""
echo -e "${BOLD}Go: ${GREEN}${TOTAL_TESTS} passed${RESET}  ${BOLD}Packages:${RESET} ${PASSED} ok, ${FAILED} failed"

if [ "$TEST_EXIT" -ne 0 ]; then
    echo ""
    echo -e "${RED}${BOLD}FAIL${RESET}"
    echo "$TEST_OUTPUT" | grep "^FAIL" || true
    exit 1
fi

# Cleanup
rm -f "$COVERFILE"
rm -rf frontend/coverage
