#!/usr/bin/env bash
# check-datasources.sh — Verify that every data-source UID referenced in
# checked-in Grafana dashboard JSON is defined in the provisioned datasource
# configuration files.
#
# A dashboard that references an unknown UID will import without error but
# render blank panels. This script catches that class of misconfiguration
# before it reaches a running Grafana instance.
#
# Usage:
#   ./infra/grafana/check-datasources.sh
#
# Exit codes:
#   0 — all dashboard data-source references are satisfied
#   1 — one or more references point to an unregistered UID
#
# Requirements:
#   jq   — available on all standard GitHub-hosted runners
#   yq   — available via 'mikefarah/yq'; used to parse YAML datasource files.
#          Install: https://github.com/mikefarah/yq#install
#          Fallback: python3 (used automatically when yq is absent)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DASHBOARD_DIR="${SCRIPT_DIR}/dashboards"
DATASOURCE_DIR="${SCRIPT_DIR}/provisioning/datasources"

log()  { echo "[grafana/check-datasources] $*"; }
err()  { echo "[grafana/check-datasources] ERROR: $*" >&2; }
pass() { echo "[grafana/check-datasources] ✓ $*"; }
fail() { echo "[grafana/check-datasources] ✗ $*" >&2; }

# ── Dependency checks ─────────────────────────────────────────────────────────

if ! command -v jq &>/dev/null; then
  err "jq is required but not installed."
  exit 1
fi

# ── Step 1: Collect registered datasource UIDs ────────────────────────────────

log "Reading datasource UIDs from ${DATASOURCE_DIR} ..."

REGISTERED_UIDS=()

for ds_file in "${DATASOURCE_DIR}"/*.yml "${DATASOURCE_DIR}"/*.yaml; do
  [[ -f "$ds_file" ]] || continue
  log "  Parsing ${ds_file##*/} ..."

  if command -v yq &>/dev/null; then
    # yq v4 syntax — emit each uid on its own line
    while IFS= read -r uid; do
      [[ -n "$uid" && "$uid" != "null" ]] && REGISTERED_UIDS+=("$uid")
    done < <(yq '.datasources[].uid' "$ds_file" 2>/dev/null || true)
  else
    # Fallback: use python3 to parse the YAML
    while IFS= read -r uid; do
      [[ -n "$uid" && "$uid" != "null" ]] && REGISTERED_UIDS+=("$uid")
    done < <(python3 - "$ds_file" <<'PYEOF'
import sys, re

path = sys.argv[1]
with open(path) as f:
    content = f.read()

# Extract uid values from lines like `  uid: some-uid`
for m in re.finditer(r'^\s+uid:\s+(\S+)', content, re.MULTILINE):
    print(m.group(1))
PYEOF
)
  fi
done

if [[ ${#REGISTERED_UIDS[@]} -eq 0 ]]; then
  err "No datasource UIDs found in ${DATASOURCE_DIR}."
  err "Ensure at least one *.yml file defines a datasource with a uid field."
  exit 1
fi

log "Registered UIDs: ${REGISTERED_UIDS[*]}"

# Build a newline-separated string for fast grep-based lookup.
REGISTERED_LIST="$(printf '%s\n' "${REGISTERED_UIDS[@]}")"

# ── Step 2: Scan dashboard JSON files for datasource references ───────────────

log "Scanning dashboard JSON in ${DASHBOARD_DIR} ..."

FAILURES=0

for dash_file in "${DASHBOARD_DIR}"/*.json; do
  [[ -f "$dash_file" ]] || continue
  dash_name="$(basename "$dash_file")"
  log "  Checking ${dash_name} ..."

  # Extract every datasource uid that is not a Grafana built-in variable
  # (those start with "$" or are "-- Grafana --").
  mapfile -t DASH_UIDS < <(
    jq -r '.. | objects | select(has("datasource"))
           | .datasource
           | if type == "object" then .uid // empty
             elif type == "string" then .
             else empty
             end' "$dash_file" 2>/dev/null \
    | grep -v '^\$' \
    | grep -v '^-- Grafana --$' \
    | sort -u
  )

  if [[ ${#DASH_UIDS[@]} -eq 0 ]]; then
    log "    No datasource references found — skipping."
    continue
  fi

  for uid in "${DASH_UIDS[@]}"; do
    if echo "$REGISTERED_LIST" | grep -qx "$uid"; then
      pass "${dash_name}: uid '${uid}' is registered."
    else
      fail "${dash_name}: uid '${uid}' is NOT registered in any datasource provisioning file."
      FAILURES=$((FAILURES + 1))
    fi
  done
done

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
if [[ "$FAILURES" -eq 0 ]]; then
  log "All dashboard datasource references are satisfied."
  exit 0
else
  err "${FAILURES} unregistered datasource reference(s) found."
  exit 1
fi
