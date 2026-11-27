#!/usr/bin/env bash
#
# Restore rehearsal harness.
#
# Exercises backup restoration into an isolated, throwaway PostgreSQL
# (docker-compose.migrations.yml) to prove that a pg_dump→psql cycle
# faithfully reproduces schema and data:
#
#   1. All indexer migrations are applied to a "source" database
#      (linkora_restore_rehearsal) to simulate a production backup state.
#   2. A small fixture (3 profiles + 1 post) is inserted directly with SQL.
#   3. pg_dump --schema-only and pg_dump --data-only are piped through psql
#      into a fresh "verify" database (linkora_restore_verify).
#   4. After restore, explicit verifications confirm:
#        a. Schema sentinel tables exist (profiles, posts, follows, blocks).
#        b. Profile count matches the fixture (3).
#        c. Post count matches the fixture (1).
#
# Any missing schema or data causes an explicit, named failure. Exits 0 on
# full success, 1 on any failure.
#
# Runs identically locally and in CI. Requires only docker (compose v2) — psql
# and pg_dump are invoked inside the postgres container, so no local client or
# version match is needed.
#
# Usage: bash tests/migrations/test-restore.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIG_DIR="$ROOT_DIR/services/indexer/migrations"
COMPOSE_FILE="$ROOT_DIR/docker-compose.migrations.yml"
PROJECT="linkora-migrations"
SERVICE="migrations-postgres"
DB_USER="linkora"

# Databases used in this harness.
SRC_DB="linkora_restore_rehearsal"
DST_DB="linkora_restore_verify"

COMPOSE=(docker compose -p "$PROJECT" -f "$COMPOSE_FILE")

START_TS=$SECONDS
FAILURES=0

log()  { echo "  $*"; }
step() { echo; echo "=== $* ==="; }
fail() { echo "  FAIL: $*"; FAILURES=$((FAILURES + 1)); }

cleanup() {
    set +e
    step "Tearing down restore rehearsal databases and compose stack"
    # Drop both rehearsal databases before stopping the container so the
    # postgres process can remove them cleanly.
    "${COMPOSE[@]}" exec -T "$SERVICE" \
        psql -h 127.0.0.1 -U "$DB_USER" -d postgres \
        -c "DROP DATABASE IF EXISTS ${SRC_DB};" >/dev/null 2>&1 || true
    "${COMPOSE[@]}" exec -T "$SERVICE" \
        psql -h 127.0.0.1 -U "$DB_USER" -d postgres \
        -c "DROP DATABASE IF EXISTS ${DST_DB};" >/dev/null 2>&1 || true
    "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
    log "done"
}
trap cleanup EXIT

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "error: required command '$1' is not installed" >&2
        exit 1
    fi
}

# All in-container psql/pg_dump calls connect over TCP (-h 127.0.0.1) rather
# than the unix socket. During first-boot initdb the official image starts a
# socket-only bootstrap server; connecting over TCP guarantees we only ever
# talk to the real server once it is genuinely accepting connections.
PGHOST_ARG=(-h 127.0.0.1)

# Run a .sql file (from the host) inside the container against the named db.
psql_file_db() {
    "${COMPOSE[@]}" exec -T "$SERVICE" \
        psql "${PGHOST_ARG[@]}" -v ON_ERROR_STOP=1 -q -U "$DB_USER" -d "$1" < "$2"
}

# Run an inline SQL statement against the named db, returning one unaligned value.
psql_value_db() {
    "${COMPOSE[@]}" exec -T "$SERVICE" \
        psql "${PGHOST_ARG[@]}" -tAX -U "$DB_USER" -d "$1" -c "$2"
}

# Run an inline SQL statement against the named db (no return value needed).
psql_exec_db() {
    "${COMPOSE[@]}" exec -T "$SERVICE" \
        psql "${PGHOST_ARG[@]}" -v ON_ERROR_STOP=1 -q -U "$DB_USER" -d "$1" -c "$2"
}

require_cmd docker

step "Starting fresh PostgreSQL"
"${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
"${COMPOSE[@]}" up -d >/dev/null
log "waiting for database to accept connections..."
READY=0
for i in $(seq 1 60); do
    # Gate on a real query over TCP: this only succeeds once the actual server
    # (not the socket-only initdb bootstrap server) is up and serving.
    if "${COMPOSE[@]}" exec -T "$SERVICE" \
        psql "${PGHOST_ARG[@]}" -U "$DB_USER" -d postgres -tAXc 'SELECT 1' >/dev/null 2>&1; then
        log "ready after ${i}s"
        READY=1
        break
    fi
    sleep 1
done
if [[ $READY -ne 1 ]]; then
    echo "error: database did not become ready in time" >&2
    exit 1
fi

# Fail loudly if no migrations were discovered (path typo / bad checkout).
shopt -s nullglob
MIGRATIONS=("$MIG_DIR"/*.sql)
shopt -u nullglob
if [[ ${#MIGRATIONS[@]} -eq 0 ]]; then
    echo "error: no migration files found in $MIG_DIR" >&2
    exit 1
fi
log "discovered ${#MIGRATIONS[@]} migration files"

step "Step 1/4: Creating source database and applying all migrations"
"${COMPOSE[@]}" exec -T "$SERVICE" \
    psql "${PGHOST_ARG[@]}" -U "$DB_USER" -d postgres \
    -c "CREATE DATABASE ${SRC_DB} OWNER ${DB_USER};" >/dev/null
log "created source database: $SRC_DB"

for m in "${MIGRATIONS[@]}"; do
    if psql_file_db "$SRC_DB" "$m" >/dev/null 2>err.log; then
        log "applied $(basename "$m")"
    else
        fail "$(basename "$m") failed to apply:"
        sed 's/^/        /' err.log
    fi
done
rm -f err.log
log "all migrations applied to $SRC_DB"

step "Step 2/4: Inserting restore rehearsal fixture"
# Small, deterministic fixture: 3 profiles (same Stellar-style addresses as
# seed-data.sql) and 1 post authored by alice.
"${COMPOSE[@]}" exec -T "$SERVICE" \
    psql "${PGHOST_ARG[@]}" -v ON_ERROR_STOP=1 -q -U "$DB_USER" -d "$SRC_DB" <<'SQL'
BEGIN;

INSERT INTO profiles (address, username, creator_token, updated_ledger) VALUES
  ('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALICE', 'alice', '', 100),
  ('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABOB',  'bob',   '', 101),
  ('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAROL',  'carol', '', 102)
ON CONFLICT (address) DO NOTHING;

INSERT INTO posts (id, author, content, tip_total, like_count, created_at) VALUES
  (1, 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALICE',
   'restore rehearsal post', 0, 0, NOW())
ON CONFLICT (id) DO NOTHING;

COMMIT;
SQL
log "fixture inserted: 3 profiles, 1 post"

# Confirm fixture counts in the source before dumping.
SRC_PROFILES="$(psql_value_db "$SRC_DB" 'SELECT count(*) FROM profiles;')"
SRC_POSTS="$(psql_value_db "$SRC_DB" 'SELECT count(*) FROM posts;')"
log "source counts: profiles=$SRC_PROFILES posts=$SRC_POSTS"

step "Step 3/4: Simulating pg_dump → psql restore cycle"
# Create a fresh, empty restore-target database.
"${COMPOSE[@]}" exec -T "$SERVICE" \
    psql "${PGHOST_ARG[@]}" -U "$DB_USER" -d postgres \
    -c "CREATE DATABASE ${DST_DB} OWNER ${DB_USER};" >/dev/null
log "created restore-target database: $DST_DB"

# Restore schema: pg_dump --schema-only piped into psql.
# --no-owner / --no-privileges: the target DB already has the right owner;
# privilege DDL is not needed in a rehearsal context and avoids role-not-found
# errors in the disposable database.
log "restoring schema..."
"${COMPOSE[@]}" exec -T "$SERVICE" \
    pg_dump "${PGHOST_ARG[@]}" -U "$DB_USER" -d "$SRC_DB" \
    --schema-only --no-owner --no-privileges --no-comments \
    | "${COMPOSE[@]}" exec -T "$SERVICE" \
        psql "${PGHOST_ARG[@]}" -v ON_ERROR_STOP=1 -q -U "$DB_USER" -d "$DST_DB"
log "schema restore complete"

# Restore data: pg_dump --data-only piped into psql.
# --disable-triggers: suppresses FK trigger firing during the bulk load
# (matches the typical pg_restore --disable-triggers pattern for data-only
# restores into a schema that already has constraints in place).
log "restoring data..."
"${COMPOSE[@]}" exec -T "$SERVICE" \
    pg_dump "${PGHOST_ARG[@]}" -U "$DB_USER" -d "$SRC_DB" \
    --data-only --no-owner --no-privileges --disable-triggers \
    | "${COMPOSE[@]}" exec -T "$SERVICE" \
        psql "${PGHOST_ARG[@]}" -v ON_ERROR_STOP=1 -q -U "$DB_USER" -d "$DST_DB"
log "data restore complete"

step "Step 4/4: Verifying restored database"

# a. Schema sentinel tables must be present.
SENTINEL_TABLES=(profiles posts follows blocks)
SCHEMA_OK=1
for t in "${SENTINEL_TABLES[@]}"; do
    COUNT="$(psql_value_db "$DST_DB" \
        "SELECT count(*)::int FROM pg_tables WHERE schemaname='public' AND tablename='$t';")"
    if [[ "$COUNT" -ne 1 ]]; then
        fail "schema sentinel table missing after restore: $t"
        SCHEMA_OK=0
    else
        log "schema sentinel present: $t"
    fi
done
if [[ $SCHEMA_OK -eq 1 ]]; then
    log "all schema sentinel tables present"
fi

# b. Profile count must match the fixture (3).
DST_PROFILES="$(psql_value_db "$DST_DB" 'SELECT count(*) FROM profiles;')"
if [[ "$DST_PROFILES" -eq 3 ]]; then
    log "profile count matches fixture: $DST_PROFILES"
else
    fail "profile count after restore is $DST_PROFILES; expected 3"
fi

# c. Post count must match the fixture (1).
DST_POSTS="$(psql_value_db "$DST_DB" 'SELECT count(*) FROM posts;')"
if [[ "$DST_POSTS" -eq 1 ]]; then
    log "post count matches fixture: $DST_POSTS"
else
    fail "post count after restore is $DST_POSTS; expected 1"
fi

ELAPSED=$((SECONDS - START_TS))
echo
echo "======================================================================"
if [[ $FAILURES -eq 0 ]]; then
    echo "PASS: all restore rehearsal checks succeeded in ${ELAPSED}s."
    exit 0
else
    echo "FAIL: $FAILURES restore rehearsal check(s) failed (${ELAPSED}s)."
    exit 1
fi
