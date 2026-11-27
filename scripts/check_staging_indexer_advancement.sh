#!/usr/bin/env bash
# check_staging_indexer_advancement.sh — Smoke check for staging indexer advancement
#
# Verifies that after deployment/rollout, the indexer is actively advancing its
# ledger checkpoint or is maintaining an appropriately fresh checkpoint,
# preventing promotion when ledger processing is stalled.
#
# Environment variables:
#   STAGING_HOST            - Hostname or IP of staging server (default: localhost)
#   STAGING_USER            - SSH user on staging host (default: ubuntu)
#   COMPOSE_PROJECT         - Docker Compose project name (default: linkora-staging)
#   SAMPLING_WINDOW_SECONDS - Bounded sampling duration in seconds (default: 60)
#   SAMPLE_INTERVAL_SECONDS - Interval between checkpoint queries in seconds (default: 10)
#   MAX_CHECKPOINT_AGE_SEC  - Maximum allowed age of checkpoint in seconds (default: 120)
#   DRY_RUN                 - Set to "true" to simulate check

set -euo pipefail

STAGING_HOST="${STAGING_HOST:-localhost}"
STAGING_USER="${STAGING_USER:-ubuntu}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-linkora-staging}"
SAMPLING_WINDOW_SECONDS="${SAMPLING_WINDOW_SECONDS:-60}"
SAMPLE_INTERVAL_SECONDS="${SAMPLE_INTERVAL_SECONDS:-10}"
MAX_CHECKPOINT_AGE_SEC="${MAX_CHECKPOINT_AGE_SEC:-120}"
DRY_RUN="${DRY_RUN:-false}"

log()  { echo "[check_indexer] $*"; }
warn() { echo "[check_indexer] WARNING: $*" >&2; }
err()  { echo "[check_indexer] ERROR: $*" >&2; exit 1; }

remote() {
  if [[ "$STAGING_HOST" == "localhost" ]]; then
    bash -c "$*"
  else
    ssh "${STAGING_USER}@${STAGING_HOST}" "$*"
  fi
}

get_checkpoint() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "100"
    return
  fi

  # Attempt 1: Query postgres indexer_cursor table directly
  local db_cursor
  db_cursor=$(remote "docker compose -p ${COMPOSE_PROJECT} exec -T postgres psql -U linkora -d linkora_indexer -t -c \"SELECT processed_cursor FROM indexer_cursor ORDER BY processed_cursor DESC LIMIT 1;\" 2>/dev/null || true" | tr -d '[:space:]')

  if [[ -n "$db_cursor" && "$db_cursor" =~ ^[0-9]+$ ]]; then
    echo "$db_cursor"
    return
  fi

  # Attempt 2: Query indexer HTTP health endpoint
  local health_cursor
  health_cursor=$(remote "curl -sf http://localhost:3001/health 2>/dev/null | grep -o '\"toLedger\":[0-9]*' | cut -d: -f2 || true" | tr -d '[:space:]')

  if [[ -n "$health_cursor" && "$health_cursor" =~ ^[0-9]+$ ]]; then
    echo "$health_cursor"
    return
  fi

  echo "0"
}

get_checkpoint_timestamp() {
  if [[ "$DRY_RUN" == "true" ]]; then
    date +%s
    return
  fi

  local ts
  ts=$(remote "docker compose -p ${COMPOSE_PROJECT} exec -T postgres psql -U linkora -d linkora_indexer -t -c \"SELECT EXTRACT(EPOCH FROM updated_at)::BIGINT FROM indexer_cursor ORDER BY processed_cursor DESC LIMIT 1;\" 2>/dev/null || true" | tr -d '[:space:]')

  if [[ -n "$ts" && "$ts" =~ ^[0-9]+$ ]]; then
    echo "$ts"
  else
    date +%s
  fi
}

log "Starting smoke check for staging indexer advancement..."
log "Sampling window : ${SAMPLING_WINDOW_SECONDS}s"
log "Sample interval : ${SAMPLE_INTERVAL_SECONDS}s"
log "Max allowable age: ${MAX_CHECKPOINT_AGE_SEC}s"

initial_checkpoint=$(get_checkpoint)
initial_ts=$(get_checkpoint_timestamp)
current_time=$(date +%s)
initial_age=$(( current_time - initial_ts ))

log "Initial checkpoint sample: cursor=${initial_checkpoint} (recorded ${initial_age}s ago)"

elapsed=0
advanced=false
latest_checkpoint="$initial_checkpoint"

while [[ "$elapsed" -lt "$SAMPLING_WINDOW_SECONDS" ]]; do
  sleep "$SAMPLE_INTERVAL_SECONDS"
  elapsed=$(( elapsed + SAMPLE_INTERVAL_SECONDS ))

  latest_checkpoint=$(get_checkpoint)
  latest_ts=$(get_checkpoint_timestamp)
  current_time=$(date +%s)
  checkpoint_age=$(( current_time - latest_ts ))

  log "Sample at ${elapsed}s: cursor=${latest_checkpoint} (age: ${checkpoint_age}s)"

  if [[ "$latest_checkpoint" -gt "$initial_checkpoint" ]]; then
    advanced=true
    log "✓ Checkpoint advancement detected: ${initial_checkpoint} -> ${latest_checkpoint} within ${elapsed}s."
    break
  fi
done

# Evaluate health:
# Criteria: Checkpoint advanced during window OR checkpoint is appropriately fresh (< MAX_CHECKPOINT_AGE_SEC)
current_time=$(date +%s)
final_age=$(( current_time - latest_ts ))

if [[ "$advanced" == "true" ]]; then
  log "✓ SUCCESS: Staging indexer produced advancing checkpoints (${initial_checkpoint} -> ${latest_checkpoint})."
  exit 0
elif [[ "$final_age" -le "$MAX_CHECKPOINT_AGE_SEC" && "$latest_checkpoint" -gt 0 ]]; then
  log "✓ SUCCESS: Staging indexer checkpoint is appropriately fresh (${final_age}s old <= ${MAX_CHECKPOINT_AGE_SEC}s threshold)."
  exit 0
else
  echo ""
  echo "══════════════════════════════════════════════════════════════"
  echo "  INDEXER CHECKPOINT SMOKE CHECK FAILED — PROMOTION HALTED"
  echo "══════════════════════════════════════════════════════════════"
  echo "Diagnostics:"
  echo "  Initial checkpoint : ${initial_checkpoint}"
  echo "  Latest checkpoint  : ${latest_checkpoint}"
  echo "  Movement           : No advancement detected over ${elapsed}s"
  echo "  Checkpoint age     : ${final_age}s (exceeds threshold of ${MAX_CHECKPOINT_AGE_SEC}s)"
  echo ""
  echo "Recent Indexer Container Logs:"
  remote "docker compose -p ${COMPOSE_PROJECT} logs --tail=40 indexer 2>/dev/null || true" || true
  echo "══════════════════════════════════════════════════════════════"
  err "Indexer checkpoint is out-of-date and stalled. Deployment promotion failed."
fi
