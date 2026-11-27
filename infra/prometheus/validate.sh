#!/usr/bin/env bash
# validate.sh — Validate Prometheus configuration and alert rules.
#
# Uses promtool to:
#   1. Check the main prometheus.yml for syntax errors.
#   2. Check all rule files for syntax and expression errors; a broken rule
#      is reported with its file name and rule name.
#   3. Run the unit-test suite in tests/ to confirm known-good rules evaluate
#      as expected.
#
# Usage:
#   ./infra/prometheus/validate.sh
#
# Exit codes:
#   0 — all checks passed
#   1 — one or more checks failed (details written to stderr)
#
# Requirements:
#   promtool  — ships with the Prometheus binary; install via the
#               'prom/prometheus' Docker image or the GitHub release tarball.
#               https://prometheus.io/download/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log()  { echo "[prometheus/validate] $*"; }
err()  { echo "[prometheus/validate] ERROR: $*" >&2; }
pass() { echo "[prometheus/validate] ✓ $*"; }
fail() { echo "[prometheus/validate] ✗ $*" >&2; }

# ── Dependency check ──────────────────────────────────────────────────────────

if ! command -v promtool &>/dev/null; then
  err "promtool is not installed."
  err "Install it from https://prometheus.io/download/ or run:"
  err "  docker run --rm -v \"\$(pwd):/work\" -w /work prom/prometheus promtool --help"
  exit 1
fi

FAILURES=0

# ── 1. Check main prometheus.yml ──────────────────────────────────────────────

log "Checking prometheus.yml ..."
if promtool check config "${SCRIPT_DIR}/prometheus.yml" 2>&1; then
  pass "prometheus.yml is valid."
else
  fail "prometheus.yml failed validation."
  FAILURES=$((FAILURES + 1))
fi

# ── 2. Check rule files ───────────────────────────────────────────────────────

log "Checking rule files ..."
RULE_FILES=("${SCRIPT_DIR}/alert-rules.yml")

for rule_file in "${RULE_FILES[@]}"; do
  log "  Checking ${rule_file##*/} ..."
  if output=$(promtool check rules "$rule_file" 2>&1); then
    pass "${rule_file##*/} is valid."
  else
    # Surface the file name and each failing rule name so engineers can fix
    # problems without searching the entire file.
    fail "${rule_file##*/} failed validation:"
    while IFS= read -r line; do
      echo "    $line" >&2
    done <<< "$output"
    FAILURES=$((FAILURES + 1))
  fi
done

# ── 3. Run unit tests ─────────────────────────────────────────────────────────

TEST_DIR="${SCRIPT_DIR}/tests"
if [[ -d "$TEST_DIR" ]]; then
  TEST_FILES=("${TEST_DIR}"/*.test.yml)
  if [[ ${#TEST_FILES[@]} -gt 0 && -f "${TEST_FILES[0]}" ]]; then
    log "Running rule unit tests ..."
    for test_file in "${TEST_FILES[@]}"; do
      log "  Running ${test_file##*/} ..."
      if output=$(promtool test rules "$test_file" 2>&1); then
        pass "${test_file##*/} passed."
      else
        fail "${test_file##*/} failed:"
        while IFS= read -r line; do
          echo "    $line" >&2
        done <<< "$output"
        FAILURES=$((FAILURES + 1))
      fi
    done
  else
    log "  No test files found in ${TEST_DIR}."
  fi
else
  log "  tests/ directory not found — skipping unit tests."
fi

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
if [[ "$FAILURES" -eq 0 ]]; then
  log "All checks passed."
  exit 0
else
  err "${FAILURES} check(s) failed."
  exit 1
fi
