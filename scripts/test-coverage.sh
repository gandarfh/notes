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

# ── Run tests ──────────────────────────────────────────────

echo -e "${BOLD}Running tests...${RESET}"
echo ""

TEST_OUTPUT=$(go test $PACKAGES -coverprofile="$COVERFILE" -count=1 -timeout 120s 2>&1)
TEST_EXIT=$?

# Count results
PASSED=$(echo "$TEST_OUTPUT" | grep -c "^ok" || true)
FAILED=$(echo "$TEST_OUTPUT" | grep -c "^FAIL" || true)
TOTAL_TESTS=$(go test $PACKAGES -v -count=1 -timeout 120s 2>&1 | grep -c "^--- PASS" || true)

# ── Parse coverage per package ─────────────────────────────

declare -a PKG_NAMES=()
declare -a PKG_COVS=()

while IFS= read -r line; do
    # Match lines like: ok  notes/internal/storage  1.2s  coverage: 88.7% of statements
    if [[ $line =~ ^ok[[:space:]]+([^[:space:]]+)[[:space:]]+.*coverage:\ ([0-9.]+)% ]]; then
        PKG_NAMES+=("${BASH_REMATCH[1]}")
        PKG_COVS+=("${BASH_REMATCH[2]}")
    # Match lines like: notes/internal/app  coverage: 0.0% of statements (no test binary)
    elif [[ $line =~ ^[[:space:]]+([^[:space:]]+)[[:space:]]+coverage:\ ([0-9.]+)% ]]; then
        PKG_NAMES+=("${BASH_REMATCH[1]}")
        PKG_COVS+=("${BASH_REMATCH[2]}")
    fi
done <<< "$TEST_OUTPUT"

# Get total from go tool cover
TOTAL_COV=$(go tool cover -func="$COVERFILE" 2>/dev/null | tail -1 | awk '{print $NF}' | tr -d '%')

# ── Print table ────────────────────────────────────────────

color_for_cov() {
    local cov=$1
    local int_cov=${cov%.*}
    if (( int_cov >= 80 )); then echo -n "$GREEN"
    elif (( int_cov >= 50 )); then echo -n "$YELLOW"
    else echo -n "$RED"
    fi
}

BAR_WIDTH=20

bar_for_cov() {
    local cov=$1
    local int_cov=${cov%.*}
    local filled=$(( int_cov * BAR_WIDTH / 100 ))
    local empty=$(( BAR_WIDTH - filled ))
    local bar=""
    for ((i=0; i<filled; i++)); do bar+="█"; done
    for ((i=0; i<empty; i++)); do bar+="░"; done
    echo -n "$bar"
}

# Header
echo -e "${BOLD}┌──────────────────────────────────┬─────────┬──────────────────────┐${RESET}"
echo -e "${BOLD}│ Package                          │ Cover % │ Bar                  │${RESET}"
echo -e "${BOLD}├──────────────────────────────────┼─────────┼──────────────────────┤${RESET}"

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

for idx in "${indices[@]}"; do
    pkg="${PKG_NAMES[$idx]}"
    cov="${PKG_COVS[$idx]}"

    # Shorten package name: notes/internal/foo → foo
    short="${pkg#notes/internal/}"

    color=$(color_for_cov "$cov")
    bar=$(bar_for_cov "$cov")

    printf "│ %-32s │ ${color}%6s%%${RESET} │ ${color}%s${RESET} │\n" "$short" "$cov" "$bar"
done

# Footer
echo -e "${BOLD}├──────────────────────────────────┼─────────┼──────────────────────┤${RESET}"
color=$(color_for_cov "$TOTAL_COV")
printf "│ ${BOLD}%-32s${RESET} │ ${color}${BOLD}%6s%%${RESET} │ ${color}%s${RESET} │\n" "TOTAL" "$TOTAL_COV" "$(bar_for_cov "$TOTAL_COV")"
echo -e "${BOLD}└──────────────────────────────────┴─────────┴──────────────────────┘${RESET}"

# Summary
echo ""
echo -e "${BOLD}Tests:${RESET} ${GREEN}${TOTAL_TESTS} passed${RESET}  ${BOLD}Packages:${RESET} ${PASSED} ok, ${FAILED} failed"

if [ "$TEST_EXIT" -ne 0 ]; then
    echo ""
    echo -e "${RED}${BOLD}FAIL${RESET}"
    echo "$TEST_OUTPUT" | grep "^FAIL" || true
    exit 1
fi

# Cleanup
rm -f "$COVERFILE"
