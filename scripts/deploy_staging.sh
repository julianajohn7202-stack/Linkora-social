#!/usr/bin/env bash
# deploy_staging.sh — Deploy Linkora microservices to a staging environment.
#
# This script deploys the notification, search, and media services using the
# docker-compose staging override on a remote host (or locally when
# STAGING_HOST is set to "localhost").
#
# Required environment variables:
#   STAGING_HOST        - SSH-reachable hostname or IP of the staging server
#                         (use "localhost" to deploy to the current machine)
#   STAGING_USER        - SSH user on the staging host (default: ubuntu)
#   STAGING_DEPLOY_DIR  - Absolute path to the project root on the staging
#                         host (default: /opt/linkora)
#
# Optional environment variables:
#   STAGING_SERVICES    - Space-separated list of services to (re)deploy.
#                         Defaults to all new microservices:
#                         "notification search media"
#   COMPOSE_PROJECT     - Docker Compose project name (default: linkora-staging)
#   SKIP_BUILD          - Set to "true" to skip docker compose build
#   DRY_RUN             - Set to "true" to print commands without running them
#
# Usage:
#   STAGING_HOST=staging.example.com ./scripts/deploy_staging.sh
#   DRY_RUN=true STAGING_HOST=staging.example.com ./scripts/deploy_staging.sh

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────

STAGING_HOST="${STAGING_HOST:-}"
STAGING_USER="${STAGING_USER:-ubuntu}"
STAGING_DEPLOY_DIR="${STAGING_DEPLOY_DIR:-/opt/linkora}"
STAGING_SERVICES="${STAGING_SERVICES:-notification search media}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-linkora-staging}"
SKIP_BUILD="${SKIP_BUILD:-false}"
DRY_RUN="${DRY_RUN:-false}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Helpers ───────────────────────────────────────────────────────────────────

log()  { echo "[deploy_staging] $*"; }
warn() { echo "[deploy_staging] WARNING: $*" >&2; }
err()  { echo "[deploy_staging] ERROR: $*" >&2; exit 1; }

run() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "  [dry-run] $*"
  else
    "$@"
  fi
}

# Run a command on the staging host (or locally when host is "localhost").
remote() {
  if [[ "$STAGING_HOST" == "localhost" ]]; then
    run bash -c "$*"
  else
    run ssh "${STAGING_USER}@${STAGING_HOST}" "$*"
  fi
}

# ── Validate inputs ────────────────────────────────────────────────────────────

[[ -z "$STAGING_HOST" ]] && err "STAGING_HOST is required."

log "Staging host : $STAGING_HOST"
log "Deploy dir   : $STAGING_DEPLOY_DIR"
log "Services     : $STAGING_SERVICES"
log "Project      : $COMPOSE_PROJECT"
[[ "$DRY_RUN" == "true" ]] && log "(DRY RUN — no commands will be executed)"

# ── Check local tooling ────────────────────────────────────────────────────────

if ! command -v docker &>/dev/null; then
  warn "docker is not installed locally — remote deploy only."
fi

# ── Step 1: Sync repository to staging host ───────────────────────────────────

log "[1/5] Syncing repository to $STAGING_HOST:$STAGING_DEPLOY_DIR ..."

if [[ "$STAGING_HOST" == "localhost" ]]; then
  log "  Local deploy — skipping rsync."
else
  run rsync -az --delete \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='dist' \
    --exclude='target' \
    --exclude='*.env' \
    --exclude='.env*' \
    "${ROOT_DIR}/" \
    "${STAGING_USER}@${STAGING_HOST}:${STAGING_DEPLOY_DIR}/"
fi

# ── Step 2: Build service images ──────────────────────────────────────────────

log "[2/5] Building service images ..."

COMPOSE_CMD="docker compose \
  -p ${COMPOSE_PROJECT} \
  -f ${STAGING_DEPLOY_DIR}/docker-compose.yml \
  -f ${STAGING_DEPLOY_DIR}/docker-compose.staging.yml"

if [[ "$SKIP_BUILD" != "true" ]]; then
  remote "${COMPOSE_CMD} build --no-cache ${STAGING_SERVICES}"
else
  log "  SKIP_BUILD=true — skipping image build."
fi

# ── Step 3: Deploy / recreate containers ─────────────────────────────────────

log "[3/5] Deploying services: $STAGING_SERVICES ..."

remote "${COMPOSE_CMD} up -d --remove-orphans ${STAGING_SERVICES}"

# ── Step 4: Health check ─────────────────────────────────────────────────────

log "[4/5] Waiting for services to become healthy ..."

# Give containers up to 60 s to pass their health checks.
HEALTH_TIMEOUT=60
HEALTH_INTERVAL=5

for service in $STAGING_SERVICES; do
  elapsed=0
  log "  Checking $service ..."
  while true; do
    status=$(remote "docker inspect --format='{{.State.Health.Status}}' \
      \$(docker compose -p ${COMPOSE_PROJECT} ps -q ${service} 2>/dev/null) 2>/dev/null || echo unknown" 2>/dev/null || echo "unknown")

    if [[ "$status" == *"healthy"* ]]; then
      log "  ✓ $service is healthy."
      break
    fi

    if [[ "$elapsed" -ge "$HEALTH_TIMEOUT" ]]; then
      warn "$service did not become healthy within ${HEALTH_TIMEOUT}s (status: $status)."
      break
    fi

    sleep "$HEALTH_INTERVAL"
    elapsed=$((elapsed + HEALTH_INTERVAL))
  done
done

# ── Step 5: Write deployment manifest ────────────────────────────────────────

log "[5/5] Writing deployment manifest ..."

MANIFEST_DIR="${ROOT_DIR}/deployment-manifests"
mkdir -p "$MANIFEST_DIR"

DEPLOY_TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
GIT_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo "unknown")"
GIT_REF="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")"
DEPLOY_ENV="${DEPLOY_ENV:-staging}"

# Collect image digests for deployed services (best-effort; empty when skipped
# or when the Docker daemon is unavailable).
IMAGE_DIGESTS="{}"
if [[ "$SKIP_BUILD" != "true" ]] && command -v docker &>/dev/null; then
  DIGEST_PAIRS=""
  for service in $STAGING_SERVICES; do
    digest=$(docker inspect \
      --format='{{index .RepoDigests 0}}' \
      "$(docker compose -p "${COMPOSE_PROJECT}" ps -q "${service}" 2>/dev/null)" \
      2>/dev/null || echo "")
    [[ -n "$digest" ]] && DIGEST_PAIRS="${DIGEST_PAIRS}\"${service}\":\"${digest}\","
  done
  [[ -n "$DIGEST_PAIRS" ]] && IMAGE_DIGESTS="{${DIGEST_PAIRS%,}}"
fi

# Capture the latest applied migration version if the migrate tool is present.
MIGRATION_VERSION="unknown"
if command -v migrate &>/dev/null; then
  MIGRATION_VERSION="$(migrate -path "${ROOT_DIR}/services/migrations" \
    -database "${DATABASE_URL:-}" version 2>/dev/null || echo "unknown")"
fi

MANIFEST_FILE="${MANIFEST_DIR}/staging-${GIT_COMMIT:0:12}-${DEPLOY_TIMESTAMP//[:.T]/-}.json"

cat > "$MANIFEST_FILE" <<JSON
{
  "schema_version": "1",
  "environment": "${DEPLOY_ENV}",
  "deployed_at": "${DEPLOY_TIMESTAMP}",
  "git": {
    "commit": "${GIT_COMMIT}",
    "ref": "${GIT_REF}"
  },
  "services": $(echo "$STAGING_SERVICES" | tr ' ' '\n' | \
    jq -Rc '[inputs]' 2>/dev/null || printf '["%s"]' "${STAGING_SERVICES// /\",\"}"),
  "image_digests": ${IMAGE_DIGESTS},
  "migration_version": "${MIGRATION_VERSION}",
  "compose_project": "${COMPOSE_PROJECT}",
  "host": "${STAGING_HOST}"
}
JSON

# Validate the manifest is well-formed JSON before treating the deployment as
# successful.  jq is available on all standard GitHub-hosted runners and in
# the project's docker-compose service images.
if ! jq empty "$MANIFEST_FILE" 2>/dev/null; then
  err "Deployment manifest is not valid JSON: $MANIFEST_FILE"
fi

log "  Manifest written: $MANIFEST_FILE"

# Emit the path so callers (e.g. the GitHub Actions workflow) can upload it as
# an artifact or reference it downstream.
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "manifest_path=${MANIFEST_FILE}" >> "$GITHUB_OUTPUT"
fi

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║            Staging Deployment Summary                       ║"
echo "╠══════════════════════════════════════════════════════════════╣"
printf  "║  %-20s %-38s ║\n" "host:"        "$STAGING_HOST"
printf  "║  %-20s %-38s ║\n" "deploy_dir:"  "$STAGING_DEPLOY_DIR"
printf  "║  %-20s %-38s ║\n" "project:"     "$COMPOSE_PROJECT"
printf  "║  %-20s %-38s ║\n" "services:"    "$STAGING_SERVICES"
printf  "║  %-20s %-38s ║\n" "git_commit:"  "${GIT_COMMIT:0:12}"
printf  "║  %-20s %-38s ║\n" "manifest:"    "$(basename "$MANIFEST_FILE")"
[[ "$DRY_RUN" == "true" ]] && \
printf  "║  %-20s %-38s ║\n" "mode:"        "DRY RUN"
echo "╚══════════════════════════════════════════════════════════════╝"
