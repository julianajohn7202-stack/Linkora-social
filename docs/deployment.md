# Linkora Backend Services — Deployment Guide

This guide covers production deployment of the three Linkora backend services:

| Service                     | Default Port | Description                                            |
| --------------------------- | ------------ | ------------------------------------------------------ |
| `services/indexer`          | 3000         | Off-chain Soroban event indexer and REST/WebSocket API |
| `services/dm-relay`         | 3001         | Transport-only E2EE direct-message relay               |
| `services/analytics-oracle` | 4000         | Ed25519 analytics attestation oracle                   |
| `services/notification`     | 3002         | Push-notification fanout and delivery service *(planned)* |
| `services/search`           | 3003         | Full-text and semantic content search service *(planned)* |

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Environment Variable Reference](#2-environment-variable-reference)
   - [Shared rate limiting (`REDIS_URL`)](#24-shared-rate-limiting-redis_url)
3. [Database Migration Steps](#3-database-migration-steps)
   - [3a. Migration Rollback Decision Matrix](#3a-migration-rollback-decision-matrix)
4. [Docker Compose Deployment](#4-docker-compose-deployment)
5. [Kubernetes Deployment](#5-kubernetes-deployment)
6. [Health Check Endpoints](#6-health-check-endpoints)
7. [Scaling Guidelines](#7-scaling-guidelines)
8. [Monitoring and Alerting](#8-monitoring-and-alerting)
9. [Backup and Recovery](#9-backup-and-recovery)
10. [Notification Service](#10-notification-service-servicesnotification)
11. [Search Service](#11-search-service-servicessearch)
13. [Preview Environment Smoke Test](#13-preview-environment-smoke-test)

---

## 1. Prerequisites

| Dependency  | Minimum Version | Notes                                                                                                   |
| ----------- | --------------- | ------------------------------------------------------------------------------------------------------- |
| Docker      | 24+             | Compose v2 required (`docker compose`)                                                                  |
| PostgreSQL  | 15+             | One database per service (or shared with separate schemas)                                              |
| Redis       | 7+              | **Required in production** — backs shared rate limiting; see [§2.4](#24-shared-rate-limiting-redis_url) |
| Stellar RPC | —               | Horizon-compatible Soroban RPC endpoint (testnet or mainnet)                                            |
| Node.js     | 18+             | Only needed for local builds outside Docker                                                             |

---

## 2. Environment Variable Reference

### 2.1 Indexer (`services/indexer`)

| Variable                                | Required | Default                    | Description                                                                                                                                                                                         |
| --------------------------------------- | -------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                          | ✅       | —                          | PostgreSQL connection string, e.g. `postgresql://user:pass@host:5432/linkora_indexer`                                                                                                               |
| `STELLAR_RPC_URL`                       | ✅       | —                          | Soroban RPC endpoint, e.g. `https://soroban-testnet.stellar.org`                                                                                                                                    |
| `CONTRACT_ID`                           | ✅       | —                          | Linkora contract address on the Stellar network                                                                                                                                                     |
| `START_LEDGER`                          | ✅       | —                          | Ledger sequence to begin indexing from (use the contract deployment ledger)                                                                                                                         |
| `PORT`                                  |          | `3000`                     | HTTP/WebSocket server port                                                                                                                                                                          |
| `REDIS_URL`                             | ✅¹      | —                          | Redis connection string backing the shared rate limiter, e.g. `redis://redis:6379`. **Startup fails when `NODE_ENV=production` and this is unset** — see [§2.4](#24-shared-rate-limiting-redis_url) |
| `ALLOW_IN_MEMORY_RATE_LIMIT`            |          | `false`                    | Opt out of the `REDIS_URL` requirement for a deliberately single-replica production deployment. Limits become per-instance                                                                          |
| `RATE_LIMIT_ANON_RPM`                   |          | `100`                      | Max read requests per minute for unauthenticated IPs                                                                                                                                                |
| `RATE_LIMIT_AUTH_RPM`                   |          | `300`                      | Max requests per minute for authenticated Stellar addresses                                                                                                                                         |
| `RATE_LIMIT_WRITE_RPM`                  |          | `50`                       | Max write requests per minute for unauthenticated IPs                                                                                                                                               |
| `RPC_RATE_LIMIT_PER_SEC`                |          | `10`                       | Outbound Soroban RPC calls per second (token-bucket)                                                                                                                                                |
| `RPC_RATE_LIMIT_BURST`                  |          | `= RPC_RATE_LIMIT_PER_SEC` | Burst capacity for outbound RPC calls                                                                                                                                                               |
| `MIN_POLL_INTERVAL_MS`                  |          | —                          | Minimum interval (ms) between event-stream polls                                                                                                                                                    |
| `MAX_POLL_INTERVAL_MS`                  |          | —                          | Maximum interval (ms) between event-stream polls (adaptive back-off ceiling)                                                                                                                        |
| `SCORE_REFRESH_INTERVAL_MINUTES`        |          | `5`                        | How often creator feed scores are recalculated                                                                                                                                                      |
| `BACKFILL_MAX_DEPTH_LEDGERS`            |          | `10000`                    | Maximum ledgers to backfill in one recovery run. Larger gaps raise an alert instead                                                                                                                 |
| `BACKFILL_BATCH_SIZE`                   |          | `100`                      | Ledgers fetched per batch during backfill                                                                                                                                                           |
| `BACKFILL_RATE_LIMIT_MS`                |          | `100`                      | Delay (ms) between backfill batches                                                                                                                                                                 |
| `BACKFILL_ALERT_THRESHOLD`              |          | `5000`                     | Alert when a detected gap exceeds this many ledgers                                                                                                                                                 |
| `BACKFILL_CIRCUIT_BREAKER_MAX_FAILURES` |          | `5`                        | Stop backfilling after this many consecutive batch failures                                                                                                                                         |
| `STATEMENT_TIMEOUT_MS`                  |          | `30000`                    | PostgreSQL statement timeout                                                                                                                                                                        |
| `LOCK_TIMEOUT_MS`                       |          | `10000`                    | PostgreSQL lock timeout                                                                                                                                                                             |
| `SLOW_QUERY_THRESHOLD_MS`               |          | `5000`                     | Log queries slower than this threshold                                                                                                                                                              |

### 2.2 DM Relay (`services/dm-relay`)

| Variable                     | Required | Default                 | Description                                                                                                                                     |
| ---------------------------- | -------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`               | ✅       | —                       | PostgreSQL connection string, e.g. `postgresql://user:pass@host:5432/linkora_dm`                                                                |
| `PORT`                       |          | `3001`                  | HTTP server port                                                                                                                                |
| `NODE_ENV`                   |          | `development`           | Set to `production` in production                                                                                                               |
| `CORS_ORIGIN`                |          | `http://localhost:3000` | Comma-separated list of allowed CORS origins                                                                                                    |
| `MESSAGE_TTL_DAYS`           |          | `7`                     | Days to retain delivered messages before the cleanup job removes them                                                                           |
| `MAX_TIMESTAMP_SKEW`         |          | `30`                    | Maximum age (seconds) of a Stellar auth timestamp before it is rejected                                                                         |
| `STELLAR_NETWORK`            |          | `Testnet`               | Stellar network passphrase identifier (`Testnet` or `Mainnet`)                                                                                  |
| `IDEMPOTENCY_TTL_HOURS`      |          | `24`                    | Hours to retain idempotency keys for deduplication                                                                                              |
| `REDIS_URL`                  | ✅¹      | —                       | Redis connection string backing the shared HTTP **and WebSocket** rate limiters. **Startup fails when `NODE_ENV=production` and this is unset** |
| `ALLOW_IN_MEMORY_RATE_LIMIT` |          | `false`                 | Opt out of the `REDIS_URL` requirement for a single-replica deployment                                                                          |
| `WS_RATE_LIMIT_MAX`          |          | `30`                    | Max WebSocket connection attempts per minute per IP                                                                                             |
| `RATE_LIMIT_ANON_RPM`        |          | `100`                   | Max requests per minute for unauthenticated IPs                                                                                                 |
| `RATE_LIMIT_AUTH_RPM`        |          | `300`                   | Max requests per minute for authenticated Stellar addresses                                                                                     |

### 2.3 Analytics Oracle (`services/analytics-oracle`)

| Variable                         | Required | Default                             | Description                                                                                                                                 |
| -------------------------------- | -------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                   | ✅       | —                                   | PostgreSQL connection string, e.g. `postgresql://user:pass@host:5432/linkora_indexer` (can share the indexer's DB — read-only queries only) |
| `SOROBAN_RPC_URL`                | ✅       | —                                   | Soroban RPC endpoint                                                                                                                        |
| `CONTRACT_ID`                    | ✅       | —                                   | Linkora contract address                                                                                                                    |
| `SECRETS`                        | ✅       | `env:ORACLE_PRIVATE_KEY_HEX`        | Signing key backend. Use `file:///path/to/key.hex` with a mounted secret in production; env fallback is dev-only                            |
| `ADMIN_SECRET`                   | ⚠️       | —                                   | Bearer token for `POST /admin/rotate-key`. **Keep secret — use a secrets manager**                                                          |
| `PORT`                           |          | `4000`                              | HTTP server port                                                                                                                            |
| `ORACLE_NAME`                    |          | `default`                           | Identifier included in on-chain attestations                                                                                                |
| `WINDOW_LEDGERS`                 |          | `1000`                              | Size of the analytics window in ledgers                                                                                                     |
| `NETWORK_PASSPHRASE`             |          | `Test SDF Network ; September 2015` | Stellar network passphrase for transaction signing                                                                                          |
| `REDIS_URL`                      | ✅¹      | —                                   | Redis connection string backing the shared rate limiter. **Startup fails when `NODE_ENV=production` and this is unset**                     |
| `ALLOW_IN_MEMORY_RATE_LIMIT`     |          | `false`                             | Opt out of the `REDIS_URL` requirement for a single-replica deployment                                                                      |
| `ORACLE_RATE_LIMIT_WINDOW_MS`    |          | `60000`                             | Rate limit window in milliseconds                                                                                                           |
| `ORACLE_RATE_LIMIT_MAX_REQUESTS` |          | `10`                                | Max requests per window per IP                                                                                                              |
| `ORACLE_RATE_LIMIT_BYPASS_IPS`   |          | —                                   | Comma-separated IPs to bypass rate limiting (e.g. internal health checkers)                                                                 |

### 2.4 Shared rate limiting (`REDIS_URL`)

¹ `REDIS_URL` is **required whenever `NODE_ENV=production`**. All three services
refuse to start without it and exit with:

```
[<service>] REDIS_URL is required when NODE_ENV=production. Without it each replica keeps
its own rate-limit counters, so the effective limit becomes RATE_LIMIT × replicaCount and
rate limiting provides no real protection. ...
```

**Why it is mandatory.** Without Redis every replica keeps its own counters. An
attacker distributing requests across a load balancer multiplies their
effective allowance by the replica count:

```
effective_limit = RATE_LIMIT_ANON_RPM × replica_count
```

With three replicas the documented 100 req/min anonymous limit becomes 300
req/min — enough to brute-force authenticated endpoints, flood the indexer API,
or bypass the DM relay's per-address send limits. Nothing in the response makes
this visible, which is why the check happens at startup rather than at runtime.

**Every replica must point at the same Redis endpoint.** Per-replica Redis
instances reproduce the original problem exactly.

**Single-replica escape hatch.** A deployment that genuinely runs one replica
can set `ALLOW_IN_MEMORY_RATE_LIMIT=true` to boot without Redis. That
deployment then reports `rateLimiter: { store: "memory", shared: false }` on
`/health` and its aggregate status is `degraded` — see
[§6](#6-health-check-endpoints). Do not set this on anything that can scale.

---

## 3. Database Migration Steps

### Indexer

The indexer uses plain SQL migrations in `services/indexer/migrations/`, numbered `001_` through `011_`. Apply them in order:

```bash
# Apply all migrations (example using psql)
for f in services/indexer/migrations/*.sql; do
  psql "$DATABASE_URL" -f "$f"
done
```

Migrations are **idempotent** — safe to re-run on an already-migrated database. All statements use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and `ADD COLUMN IF NOT EXISTS`. There are no destructive `DROP` statements.

To validate migrations locally:

```bash
# Requires Docker + Compose v2
bash tests/migrations/test-migrations.sh
```

After an intentional schema change, refresh the snapshot:

```bash
bash tests/migrations/update-schema-snapshot.sh
```

See [`services/indexer/migrations/README.md`](../services/indexer/migrations/README.md) for the full authoring rules and reversibility policy.

### DM Relay

The dm-relay's migrations live in `services/dm-relay/migrations/`:

```bash
psql "$DATABASE_URL" -f services/dm-relay/migrations/001_message_idempotency.sql
psql "$DATABASE_URL" -f services/dm-relay/migrations/002_scope_idempotency_by_sender.sql
```

Or use the built-in migration script:

```bash
cd services/dm-relay && pnpm db:migrate
```

### Analytics Oracle

The oracle reads from the indexer's database (read-only). No schema of its own needs to be created.

---

## 3a. Migration Rollback Decision Matrix

When a migration has been applied but the release is unhealthy, operators must
choose between three strategies. The choice depends on whether the migration is
reversible and whether application writes have already landed against the new
schema.

### Decision matrix

| Scenario                                           | Preconditions                                                                                        | Strategy                                                                                                                          | Verification query                                                                                                                                                                            |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reversible migration, no post-migration writes** | Migration is additive (new column or index only); no application writes have used the new column yet | **Roll forward** to a fixed release, or revert with the reverse migration script                                                  | `SELECT COUNT(*) FROM <table> WHERE <new_column> IS NOT NULL;` — expect `0` if no writes landed                                                                                               |
| **Reversible migration, writes already landed**    | New column exists; rows have been written using it before the rollback decision was made             | **Roll forward** only — do not drop the column; existing data would be destroyed                                                  | `SELECT MAX(created_at) FROM <table>;` — compare against the migration timestamp to confirm writes exist                                                                                      |
| **Destructive or partially applied migration**     | A `DROP COLUMN` or `DROP TABLE` ran, or the migration exited mid-run leaving the schema inconsistent | **Restore from snapshot** — stop writes, restore the last pre-migration backup, replay the indexer from the last clean checkpoint | `SELECT column_name FROM information_schema.columns WHERE table_name = '<table>';` to confirm column presence; `SELECT processed_cursor FROM indexer_state;` to verify the indexer checkpoint |

### Roll-forward procedure

Use roll-forward when the schema is intact and no writes depend on a column
being absent:

```bash
# 1. Deploy the fixed release image
docker compose pull indexer dm-relay analytics-oracle
docker compose up -d --no-deps indexer dm-relay analytics-oracle

# 2. Apply the corrective migration
psql "$DATABASE_URL" -f services/indexer/migrations/<NNN>_fix.sql

# 3. Confirm the schema matches the expected snapshot
psql "$DATABASE_URL" -c "\d+ <table>"
```

### Restore from snapshot procedure

Use restore when writes have already corrupted the new schema, or when the
migration is partially applied and the schema is inconsistent:

```bash
# 1. Stop all services to prevent further writes
docker compose stop indexer dm-relay analytics-oracle

# 2. Restore the last pre-migration snapshot
gunzip -c indexer-<snapshot-date>.sql.gz | psql "$DATABASE_URL_INDEXER"

# 3. Set START_LEDGER in .env to the ledger recorded just before the migration
#    so the indexer re-derives on-chain state from a known clean point
#    Example:
#    START_LEDGER=12340000

# 4. Restart services — the indexer backfills from START_LEDGER automatically
docker compose up -d
```

> **Effect on writes made after the snapshot.** Any writes that arrived between
> the snapshot and the restore are lost. The indexer re-derives on-chain data
> (posts, follows, tips) by replaying Soroban events from `START_LEDGER`, but
> off-chain data (DM relay messages, oracle attestation cache) is not recovered
> automatically. Coordinate with users if messages in the restore window are
> business-critical.

### Checkpoint reconciliation

After a restore, verify the indexer cursor has caught up and dependent services
agree on the current state:

```sql
-- Confirm processed_cursor is advancing past the restore point
SELECT processed_cursor FROM indexer_state;

-- Confirm no ledger gap remains in the events table
SELECT MAX(ledger_sequence) AS latest_indexed FROM events;
```

Compare `latest_indexed` against the current Stellar network ledger via the
Soroban RPC endpoint:

```bash
curl -s "$STELLAR_RPC_URL/health" | jq '.latestLedger'
```

The difference should be within your `BACKFILL_ALERT_THRESHOLD` (default
5 000 ledgers). If the gap is larger, increase `BACKFILL_MAX_DEPTH_LEDGERS`
temporarily and restart the indexer, then restore it to the default once
backfill completes.

---

## 4. Docker Compose Deployment

Save the following as `docker-compose.yml` at the repo root and populate a `.env` file with the required variables.

```yaml
version: "3.9"

services:
  postgres-indexer:
    image: postgres:15-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: linkora_indexer
      POSTGRES_USER: linkora
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - indexer-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U linkora -d linkora_indexer"]
      interval: 10s
      timeout: 5s
      retries: 5

  postgres-dm:
    image: postgres:15-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: linkora_dm
      POSTGRES_USER: linkora
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - dm-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U linkora -d linkora_dm"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  indexer:
    build:
      context: services/indexer
      dockerfile: Dockerfile
    restart: unless-stopped
    depends_on:
      postgres-indexer:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://linkora:${POSTGRES_PASSWORD}@postgres-indexer:5432/linkora_indexer
      STELLAR_RPC_URL: ${STELLAR_RPC_URL}
      CONTRACT_ID: ${CONTRACT_ID}
      START_LEDGER: ${START_LEDGER}
      REDIS_URL: redis://redis:6379
      NODE_ENV: production
    ports:
      - "3000:3000"
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:3000/health/ready || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 30s

  dm-relay:
    build:
      context: services/dm-relay
      dockerfile: Dockerfile
    restart: unless-stopped
    depends_on:
      postgres-dm:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://linkora:${POSTGRES_PASSWORD}@postgres-dm:5432/linkora_dm
      REDIS_URL: redis://redis:6379
      NODE_ENV: production
      STELLAR_NETWORK: ${STELLAR_NETWORK}
      CORS_ORIGIN: ${CORS_ORIGIN}
    ports:
      - "3001:3001"
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:3001/health/ready || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 30s

  analytics-oracle:
    build:
      context: services/analytics-oracle
      dockerfile: Dockerfile
    restart: unless-stopped
    depends_on:
      postgres-indexer:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://linkora:${POSTGRES_PASSWORD}@postgres-indexer:5432/linkora_indexer
      SOROBAN_RPC_URL: ${STELLAR_RPC_URL}
      CONTRACT_ID: ${CONTRACT_ID}
      SECRETS: file:///run/secrets/oracle-key.hex
      ADMIN_SECRET: ${ADMIN_SECRET}
      REDIS_URL: redis://redis:6379
      NODE_ENV: production
      NETWORK_PASSPHRASE: ${NETWORK_PASSPHRASE}
    ports:
      - "4000:4000"
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:4000/health/ready || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 30s

volumes:
  indexer-pgdata:
  dm-pgdata:
  redis-data:
```

Minimal `.env`:

```bash
POSTGRES_PASSWORD=changeme
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
CONTRACT_ID=C...
START_LEDGER=12345678
ADMIN_SECRET=<high-entropy bearer token>
STELLAR_NETWORK=Testnet
NETWORK_PASSPHRASE=Test SDF Network ; September 2015
CORS_ORIGIN=https://app.linkora.io
```

Start all services:

```bash
# Run migrations first
docker compose run --rm indexer sh -c 'for f in /app/migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done'
docker compose run --rm dm-relay pnpm db:migrate

# Start everything
docker compose up -d

# Tail logs
docker compose logs -f indexer dm-relay analytics-oracle
```

---

## 5. Kubernetes Deployment

The manifests below cover a single-namespace production deployment. Adjust resource limits for your cluster.

### 5.1 Secrets

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: linkora-secrets
  namespace: linkora
type: Opaque
stringData:
  DATABASE_URL_INDEXER: "postgresql://linkora:changeme@postgres-indexer:5432/linkora_indexer"
  DATABASE_URL_DM: "postgresql://linkora:changeme@postgres-dm:5432/linkora_dm"
  ORACLE_KEY_HEX: "<32-byte hex>"
  ADMIN_SECRET: "<high-entropy bearer token>"
  REDIS_URL: "redis://redis:6379"
```

### 5.2 Indexer Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: indexer
  namespace: linkora
spec:
  replicas: 2
  selector:
    matchLabels:
      app: indexer
  template:
    metadata:
      labels:
        app: indexer
    spec:
      containers:
        - name: indexer
          image: ghcr.io/epta-node/linkora-indexer:latest
          ports:
            - containerPort: 3000
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: linkora-secrets
                  key: DATABASE_URL_INDEXER
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: linkora-secrets
                  key: REDIS_URL
            - name: STELLAR_RPC_URL
              value: "https://soroban-testnet.stellar.org"
            - name: CONTRACT_ID
              value: "C..."
            - name: START_LEDGER
              value: "12345678"
            - name: NODE_ENV
              value: "production"
          livenessProbe:
            httpGet:
              path: /health/live
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 3000
            initialDelaySeconds: 15
            periodSeconds: 10
          startupProbe:
            httpGet:
              path: /health/startup
              port: 3000
            failureThreshold: 30
            periodSeconds: 10
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "256Mi"
          volumeMounts:
            - name: oracle-key
              mountPath: /run/secrets/oracle-key.hex
              subPath: oracle-key.hex
              readOnly: true
      volumes:
        - name: oracle-key
          secret:
            secretName: linkora-secrets
            items:
              - key: ORACLE_KEY_HEX
                path: oracle-key.hex
              - key: ADMIN_SECRET
                path: admin-secret
---
apiVersion: v1
kind: Service
metadata:
  name: indexer
  namespace: linkora
spec:
  selector:
    app: indexer
  ports:
    - port: 3000
      targetPort: 3000
```

### 5.3 DM Relay Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dm-relay
  namespace: linkora
spec:
  replicas: 2
  selector:
    matchLabels:
      app: dm-relay
  template:
    metadata:
      labels:
        app: dm-relay
    spec:
      containers:
        - name: dm-relay
          image: ghcr.io/epta-node/linkora-dm-relay:latest
          ports:
            - containerPort: 3001
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: linkora-secrets
                  key: DATABASE_URL_DM
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: linkora-secrets
                  key: REDIS_URL
            - name: STELLAR_NETWORK
              value: "Testnet"
            - name: NODE_ENV
              value: "production"
            - name: CORS_ORIGIN
              value: "https://app.linkora.io"
          livenessProbe:
            httpGet:
              path: /health/live
              port: 3001
            initialDelaySeconds: 10
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 3001
            initialDelaySeconds: 15
            periodSeconds: 10
          startupProbe:
            httpGet:
              path: /health/startup
              port: 3001
            failureThreshold: 30
            periodSeconds: 10
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "256Mi"
---
apiVersion: v1
kind: Service
metadata:
  name: dm-relay
  namespace: linkora
spec:
  selector:
    app: dm-relay
  ports:
    - port: 3001
      targetPort: 3001
```

### 5.4 Analytics Oracle Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: analytics-oracle
  namespace: linkora
spec:
  replicas: 1 # Only one oracle should submit attestations to avoid duplicate on-chain txns
  selector:
    matchLabels:
      app: analytics-oracle
  template:
    metadata:
      labels:
        app: analytics-oracle
    spec:
      containers:
        - name: analytics-oracle
          image: ghcr.io/epta-node/linkora-analytics-oracle:latest
          ports:
            - containerPort: 4000
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: linkora-secrets
                  key: DATABASE_URL_INDEXER
            - name: SECRETS
              value: "file:///run/secrets/oracle-key.hex"
            - name: ADMIN_SECRET
              valueFrom:
                secretKeyRef:
                  name: linkora-secrets
                  key: ADMIN_SECRET
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: linkora-secrets
                  key: REDIS_URL
            - name: SOROBAN_RPC_URL
              value: "https://soroban-testnet.stellar.org"
            - name: CONTRACT_ID
              value: "C..."
            - name: NODE_ENV
              value: "production"
          livenessProbe:
            httpGet:
              path: /health/live
              port: 4000
            initialDelaySeconds: 10
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 4000
            initialDelaySeconds: 15
            periodSeconds: 10
          startupProbe:
            httpGet:
              path: /health/startup
              port: 4000
            failureThreshold: 30
            periodSeconds: 10
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "256Mi"
---
apiVersion: v1
kind: Service
metadata:
  name: analytics-oracle
  namespace: linkora
spec:
  selector:
    app: analytics-oracle
  ports:
    - port: 4000
      targetPort: 4000
```

---

## 6. Health Check Endpoints

All three services expose Kubernetes-compatible probes on the same paths:

| Endpoint              | Probe type | Returns 200 when                                                     |
| --------------------- | ---------- | -------------------------------------------------------------------- |
| `GET /health`         | Aggregate  | Dependencies reachable; reports degraded modes                       |
| `GET /health/live`    | Liveness   | Process is running                                                   |
| `GET /health/ready`   | Readiness  | Database (and Stellar RPC for oracle/indexer) reachable              |
| `GET /health/startup` | Startup    | Initial bootstrap complete (first window processed / DB initialised) |

Example readiness response:

```json
{
  "status": "ready",
  "degraded": false,
  "checks": {
    "database": { "status": "up", "latencyMs": 3 },
    "stellar_rpc": { "status": "up", "latencyMs": 45 },
    "rateLimiter": { "store": "redis", "shared": true }
  }
}
```

A `503` response indicates `"not_ready"` — the load balancer should stop routing traffic until the probe recovers.

### Rate limiter status

Every service reports which store backs its rate limiter:

| Field                | Values               | Meaning                                                           |
| -------------------- | -------------------- | ----------------------------------------------------------------- |
| `rateLimiter.store`  | `"redis"`/`"memory"` | The backing store the limiter connected to at startup             |
| `rateLimiter.shared` | `true`/`false`       | Whether limit state is shared across every replica of the service |

When `shared` is `false`, limits are enforced per replica — a scaled deployment's
real limit is `limit × replicaCount`. `GET /health` reports `"status": "degraded"`
in that case:

```json
{
  "status": "degraded",
  "uptime": 421,
  "rateLimiter": { "store": "memory", "shared": false },
  "checks": { "database": { "status": "up", "latencyMs": 3 } }
}
```

This is deliberately **not** a readiness failure. A single-replica deployment
that opted in via `ALLOW_IN_MEMORY_RATE_LIMIT` is still serving correctly, and
removing the pod from the load balancer would turn a weak limit into an outage.
Alert on `status == "degraded"` instead, and treat it as a configuration bug on
anything running more than one replica.

---

## 7. Scaling Guidelines

### Indexer

- **Horizontal scaling is supported** — multiple replicas share rate-limit state via Redis and process the same event stream. The `IngestPipeline` is idempotent (events are deduplicated by `(ledger_sequence, event_index)` primary key), so duplicate processing across replicas is safe.
- `REDIS_URL` is mandatory in production, and every replica must point at the **same** Redis endpoint — per-replica instances give each replica its own counters again. Confirm with `GET /health` → `rateLimiter.shared == true`.
- The WebSocket `/ws` endpoint broadcasts events via the in-process `EventBus`. For multi-replica WebSocket support, route clients to a single replica with sticky sessions, or introduce a Redis pub/sub fanout layer.
- Tune `RPC_RATE_LIMIT_PER_SEC` to stay within your Soroban RPC provider's limits.

### DM Relay

- **Stateless** — all state is in PostgreSQL. Scale replicas freely.
- `REDIS_URL` is mandatory in production and shares both the HTTP counters and the per-IP WebSocket connection limit across replicas. Confirm with `GET /health` → `rateLimiter.shared == true`.
- WebSocket connections (`/ws`) require sticky sessions if scaling to multiple replicas without a shared pub/sub layer.

### Analytics Oracle

- **Run as a single replica.** The oracle signs and submits on-chain attestations; multiple replicas would submit duplicate transactions and waste Stellar fees.
- `REDIS_URL` is still required in production. A single-replica oracle may set `ALLOW_IN_MEMORY_RATE_LIMIT=true` instead, accepting that `/health` reports `degraded`.
- If high availability is required, use a standby replica with a distributed lock (e.g. Redis `SET NX`) to ensure only one instance submits at a time.

---

## 7a. Nginx / Load Balancer Rate Limiting

An Nginx reverse proxy is provided at `infra/nginx/nginx.conf` and is included in the Docker Compose stack. It adds infrastructure-level rate limiting on top of the application-level limits already enforced inside each service.

### Media upload rate limit

| Endpoint | Method | Limit | Burst | Response on violation |
| --- | --- | --- | --- | --- |
| `/api/posts` | `POST` | 10 requests / minute / IP | 2 | `429 Too Many Requests` |
| `/api/posts/*/media` | `POST` | 10 requests / minute / IP | 2 | `429 Too Many Requests` |

When the limit is exceeded Nginx returns:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 60
Content-Type: text/html
```

The `Retry-After: 60` header tells clients to wait 60 seconds (one rate-limit window) before retrying. Mobile and web clients should surface this to the user as a friendly "please wait before uploading again" message.

### How it works

The Nginx configuration uses two `limit_req_zone` directives keyed by `$binary_remote_addr` (the client IP in 4-byte binary form, minimising memory use):

```nginx
# 10 uploads per minute per IP — applied to POST /api/posts and POST /api/posts/*/media
limit_req_zone $binary_remote_addr zone=media_upload:10m rate=10r/m;

# 100 read requests per minute per IP — defence-in-depth on all other /api/* routes
limit_req_zone $binary_remote_addr zone=api_read:10m rate=100r/m;

limit_req_status 429;
```

The `burst=2 nodelay` parameters allow a burst of two requests above the limit to be served immediately (not queued), after which further requests within the window are rejected with 429.

### Deployment configuration

The Nginx service is included in the root `docker-compose.yml` and starts after all three backend services are healthy. It listens on port **80** and proxies:

| Path prefix | Upstream |
| --- | --- |
| `/api/`, `/ws`, `/health`, `/metrics` | `indexer:3000` |
| `/relay/` | `dm-relay:3001` |
| `/oracle/` | `analytics-oracle:4000` |

### Staging and production

Apply the same `infra/nginx/nginx.conf` in staging and production. In a Kubernetes environment, use an `nginx.conf` ConfigMap and mount it into your Nginx Deployment, or configure equivalent rules in your cloud load balancer (e.g. AWS ALB request throttling or Cloudflare rate limiting rules) targeting the same endpoints and thresholds.

> **Note:** The infrastructure-level limit (10 uploads / min / IP) is independent of the application-level write rate limit (`RATE_LIMIT_WRITE_RPM`, default 50 RPM). Both are enforced; the stricter per-IP limit applies first at the proxy layer.

---

## 8. Monitoring and Alerting

All services emit structured JSON logs via [pino](https://getpino.io). Each log line includes a `service` field for easy filtering.

### Key log events to alert on

| Service | Log message                                      | Severity | Action                                                                                       |
| ------- | ------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------- |
| Indexer | `Startup gap detected`                           | WARN     | Verify backfill completes; check `BACKFILL_CIRCUIT_BREAKER_MAX_FAILURES`                     |
| Indexer | `backfill_alert` metric                          | WARN     | Gap exceeds `BACKFILL_ALERT_THRESHOLD`; manual intervention may be needed                    |
| Indexer | `Fatal error`                                    | ERROR    | Pod crashed; check DB/RPC connectivity                                                       |
| All     | `REDIS_URL is not set`                           | WARN     | Rate limiting is per-instance; set `REDIS_URL` in multi-replica deployments                  |
| All     | `REDIS_URL is required when NODE_ENV=production` | FATAL    | Service refused to start — set `REDIS_URL` (or `ALLOW_IN_MEMORY_RATE_LIMIT` for one replica) |
| Oracle  | `Attestation submission failed`                  | ERROR    | RPC or signing error; check `SOROBAN_RPC_URL` and the configured `SECRETS` key source        |
| Oracle  | `Rate limit exceeded`                            | WARN     | Potential abuse; review `ORACLE_RATE_LIMIT_MAX_REQUESTS`                                     |

### Recommended metrics (Prometheus / Grafana)

Scrape the `/health/ready` endpoint and expose the following:

- `http_requests_total{service, status_code}` — request throughput and error rate
- `http_request_duration_ms` — latency percentiles (p50, p95, p99)
- `postgres_query_duration_ms` — slow query frequency (logged above `SLOW_QUERY_THRESHOLD_MS`)
- `indexer_lag_ledgers` — difference between latest on-chain ledger and `processed_cursor`
- `backfill_gap_ledgers` — size of any detected backfill gap

### Health check monitoring

Poll `/health/ready` every 30 seconds from an external uptime monitor (e.g. UptimeRobot, Pingdom). Alert if the endpoint returns non-200 for two consecutive checks.

Also poll `/health` and alert on `rateLimiter.shared == false` for any deployment
with more than one replica — the limiter is running per-instance and the
documented limits are not being enforced.

---

## 9. Backup and Recovery

### PostgreSQL

**Indexer database**

The indexer database is **fully re-derivable** by replaying Soroban events from `START_LEDGER`. In practice, restore from a backup to avoid hours of re-indexing:

```bash
# Backup
pg_dump "$DATABASE_URL_INDEXER" | gzip > indexer-$(date +%Y%m%d).sql.gz

# Restore
gunzip -c indexer-<date>.sql.gz | psql "$DATABASE_URL_INDEXER"
```

**DM Relay database**

Messages are ephemeral (TTL controlled by `MESSAGE_TTL_DAYS`) but the idempotency table should be backed up to avoid re-processing of in-flight messages on restore:

```bash
# Backup
pg_dump "$DATABASE_URL_DM" | gzip > dm-relay-$(date +%Y%m%d).sql.gz

# Restore
gunzip -c dm-relay-<date>.sql.gz | psql "$DATABASE_URL_DM"
```

Recommended backup schedule: daily snapshots retained for 7 days, weekly snapshots retained for 4 weeks.

### Indexer recovery after downtime

If the indexer was offline and missed ledgers, it detects the gap automatically on startup and backfills via `BackfillCoordinator`. The maximum auto-backfill depth is controlled by `BACKFILL_MAX_DEPTH_LEDGERS` (default 10 000). For larger gaps:

1. Check the structured log for `Startup gap detected` to see the gap size.
2. Increase `BACKFILL_MAX_DEPTH_LEDGERS` temporarily, restart, and let it backfill.
3. Restore `BACKFILL_MAX_DEPTH_LEDGERS` to the default after recovery.

### Oracle key recovery and rotation

The oracle signing key is a 32-byte Ed25519 seed. It is loaded at startup from a
secret file (see `SECRETS` in the table above) and never passed via an
environment variable in production. If lost, a new key must be registered
on-chain via governance.

**Key rotation without restart:** store the new seed at the `SECRETS` file path
(updating the mounted secret), then call the authenticated admin endpoint:

```
curl -X POST http://<oracle>/admin/rotate-key \
  -H "Authorization: Bearer $ADMIN_SECRET"
```

The service reloads the key atomically, derives the new public key, invalidates
the attestation cache, and continues signing under the new key. The old raw seed
is zeroed on the heap. Then register the new public key on-chain via governance.

**Store the key in a secrets manager** (AWS Secrets Manager, GCP Secret Manager,
HashiCorp Vault) and mount it as a file. Never commit it to source control. The
`ADMIN_SECRET` bearer token must likewise be stored in a secrets manager and
never hard-coded.

### Redis

Redis holds only transient rate-limit state. No backup is required — on restart the counters reset gracefully and services continue operating, losing at most one window of enforcement.

Redis is, however, a **hard startup dependency in production**: services validate `REDIS_URL` before binding a port. Treat it as a required component of the deployment, not an optional cache, and make sure every replica of a service resolves to the same Redis endpoint.

---

## 10. Staging Environment Deployment

The staging environment uses a Docker Compose override file (`docker-compose.staging.yml`) layered on top of the base `docker-compose.yml`. This adds the three new microservices — **notification**, **search**, and **media** — and sets `NODE_ENV=staging` on all existing services.

### Quick start

```bash
# Copy and fill in staging-specific values
cp .env.example .env.staging

# Bring up the full stack (base services + new microservices)
docker compose \
  -f docker-compose.yml \
  -f docker-compose.staging.yml \
  --env-file .env.staging \
  up -d
```

### Manual deploy via script

`scripts/deploy_staging.sh` syncs the repository to a remote host and
(re)deploys the new microservices:

```bash
# Deploy all three new services to a remote staging host
STAGING_HOST=staging.example.com \
STAGING_USER=ubuntu \
STAGING_DEPLOY_DIR=/opt/linkora \
  ./scripts/deploy_staging.sh

# Deploy only the notification service (dry run first)
DRY_RUN=true \
STAGING_HOST=staging.example.com \
STAGING_SERVICES=notification \
  ./scripts/deploy_staging.sh

# Run without dry-run
STAGING_HOST=staging.example.com \
STAGING_SERVICES=notification \
  ./scripts/deploy_staging.sh
```

| Variable             | Required | Default                     | Description                               |
| -------------------- | -------- | --------------------------- | ----------------------------------------- |
| `STAGING_HOST`       | ✅       | —                           | SSH hostname or IP of the staging server  |
| `STAGING_USER`       |          | `ubuntu`                    | SSH login user                            |
| `STAGING_DEPLOY_DIR` |          | `/opt/linkora`              | Absolute project path on the staging host |
| `STAGING_SERVICES`   |          | `notification search media` | Services to (re)deploy                    |
| `COMPOSE_PROJECT`    |          | `linkora-staging`           | Docker Compose project name               |
| `SKIP_BUILD`         |          | `false`                     | Skip `docker compose build`               |
| `DRY_RUN`            |          | `false`                     | Print commands without executing them     |

### CI/CD workflow

The `.github/workflows/deploy-staging.yml` workflow triggers automatically on
every push to `main` that touches any service directory or Compose file. It can
also be triggered manually via the GitHub Actions UI with optional `services`
and `skip_build` inputs.

Required GitHub Actions environment (`staging`):

| Secret / Variable    | Type     | Description                                     |
| -------------------- | -------- | ----------------------------------------------- |
| `STAGING_SSH_KEY`    | Secret   | Private SSH key for the staging host            |
| `STAGING_HOST`       | Variable | Staging server hostname or IP                   |
| `STAGING_USER`       | Variable | SSH login user (default `ubuntu`)               |
| `STAGING_DEPLOY_DIR` | Variable | Project root path on the staging host           |
| `STAGING_BASE_URL`   | Variable | Base URL shown as the environment URL in GitHub |

### Service ports in staging

| Service        | Port |
| -------------- | ---- |
| `notification` | 3002 |
| `search`       | 3003 |
| `media`        | 3004 |

##

---

## 10. Notification Service (`services/notification`)

> **Status: planned.** The notification service has not been implemented yet.
> This section documents the expected deployment contract so infra can be
> provisioned ahead of the service going live.

### 10.1 Overview

The notification service fans out push notifications to clients when on-chain or
relay events (new DMs, likes, tips, governance votes) are dispatched. It
subscribes to the indexer WebSocket feed and the DM relay event stream, enriches
events, and delivers them to web-push (VAPID) and mobile-push (APNs / FCM)
targets registered by each user.

### 10.2 Docker image build

```bash
docker build \
  --file services/notification/Dockerfile \
  --tag linkora-notification:latest \
  services/notification
```

### 10.3 Environment variables

| Variable                  | Required | Default       | Description                                                                                                     |
| ------------------------- | -------- | ------------- | --------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`            | ✅       | —             | PostgreSQL connection string for storing device tokens and delivery receipts                                    |
| `PORT`                    |          | `3002`        | HTTP server port                                                                                                 |
| `NODE_ENV`                |          | `development` | Runtime environment. Set to `production` in deployed environments                                               |
| `REDIS_URL`               | ✅¹      | —             | Redis endpoint for shared rate limiting and fanout pub/sub. **Startup fails in production when unset**          |
| `ALLOW_IN_MEMORY_RATE_LIMIT` |       | `false`       | Opt out of the `REDIS_URL` requirement for a deliberately single-replica deployment                             |
| `INDEXER_WS_URL`          | ✅       | —             | WebSocket URL of the indexer service used to subscribe to on-chain events, e.g. `ws://indexer:3000/ws`          |
| `DM_RELAY_WS_URL`         |          | —             | WebSocket URL of the dm-relay service for DM delivery events, e.g. `ws://dm-relay:3001/ws`                     |
| `VAPID_PUBLIC_KEY`        | ✅       | —             | Web-push VAPID public key (base64url). Generate with: `npx web-push generate-vapid-keys`                       |
| `VAPID_PRIVATE_KEY`       | ✅       | —             | Web-push VAPID private key. **Store in a secrets manager; never commit to source control**                      |
| `VAPID_SUBJECT`           | ✅       | —             | VAPID subject: a mailto or https URL identifying the sender, e.g. `mailto:ops@linkora.io`                       |
| `FCM_SERVER_KEY`          |          | —             | Firebase Cloud Messaging server key for Android push. **Store in a secrets manager**                            |
| `APNS_KEY_ID`             |          | —             | Apple Push Notification service key ID for iOS push                                                             |
| `APNS_TEAM_ID`            |          | —             | Apple developer team ID for APNs                                                                                |
| `APNS_PRIVATE_KEY`        |          | —             | APNs private key (PEM). **Store in a secrets manager; never commit to source control**                          |
| `CORS_ORIGIN`             |          | `http://localhost:3000` | Comma-separated allowed CORS origins for the subscription API                                         |
| `LOG_LEVEL`               |          | `info`        | Minimum log level: `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal`                                |

¹ `REDIS_URL` is required whenever `NODE_ENV=production` — see [§2.4](#24-shared-rate-limiting-redis_url).

### 10.4 Health check endpoint

```
GET http://localhost:3002/health/ready
```

The service is ready when its database connection, Redis connection, and
indexer WebSocket subscription are all healthy:

```json
{
  "status": "ready",
  "checks": {
    "database": { "status": "up", "latencyMs": 4 },
    "redis": { "status": "up" },
    "indexer_ws": { "status": "connected" }
  }
}
```

### 10.5 Docker Compose snippet

Add the following service to `docker-compose.yml` once `services/notification`
is implemented:

```yaml
notification:
  build:
    context: services/notification
    dockerfile: Dockerfile
  restart: unless-stopped
  depends_on:
    postgres-notification:
      condition: service_healthy
    redis:
      condition: service_healthy
    indexer:
      condition: service_healthy
  environment:
    DATABASE_URL: postgresql://linkora:${POSTGRES_PASSWORD}@postgres-notification:5432/linkora_notification
    REDIS_URL: redis://redis:6379
    INDEXER_WS_URL: ws://indexer:3000/ws
    VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY}
    VAPID_PRIVATE_KEY: ${VAPID_PRIVATE_KEY}
    VAPID_SUBJECT: ${VAPID_SUBJECT}
    NODE_ENV: production
  ports:
    - "3002:3002"
  healthcheck:
    test: ["CMD-SHELL", "curl -f http://localhost:3002/health/ready || exit 1"]
    interval: 15s
    timeout: 5s
    retries: 3
    start_period: 30s
```

### 10.6 Scaling notes

- The fanout subscriber (indexer WebSocket connection) should run on **one
  primary replica**. Additional replicas can serve the HTTP subscription
  registration API without subscribing to the event stream.
- Use Redis pub/sub to distribute fanout work across replicas once load
  warrants it.
- APNs connections maintain persistent long-lived TCP sessions — plan
  connection-pool sizing accordingly.
- `REDIS_URL` is mandatory in production and must point at the same endpoint
  as all other services to share the rate-limit store.

---

## 11. Search Service (`services/search`)

> **Status: planned.** The search service has not been implemented yet.
> This section documents the expected deployment contract so infra can be
> provisioned ahead of the service going live.

### 11.1 Overview

The search service provides full-text and semantic content search over posts,
profiles, and pools. It indexes events from the Linkora indexer and exposes a
REST query API consumed by the web and mobile frontends.

### 11.2 Docker image build

```bash
docker build \
  --file services/search/Dockerfile \
  --tag linkora-search:latest \
  services/search
```

### 11.3 Environment variables

| Variable                 | Required | Default       | Description                                                                                                   |
| ------------------------ | -------- | ------------- | ------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           | ✅       | —             | PostgreSQL connection string for the search index tables                                                      |
| `PORT`                   |          | `3003`        | HTTP server port                                                                                               |
| `NODE_ENV`               |          | `development` | Runtime environment. Set to `production` in deployed environments                                             |
| `REDIS_URL`              | ✅¹      | —             | Redis endpoint for shared rate limiting. **Startup fails in production when unset**                           |
| `ALLOW_IN_MEMORY_RATE_LIMIT` |      | `false`       | Opt out of the `REDIS_URL` requirement for a deliberately single-replica deployment                           |
| `INDEXER_URL`            | ✅       | —             | Base URL of the indexer REST API used to consume post/profile data, e.g. `http://indexer:3000`               |
| `INDEXER_WS_URL`         | ✅       | —             | WebSocket URL of the indexer for real-time index updates, e.g. `ws://indexer:3000/ws`                        |
| `SEARCH_ENGINE`          |          | `pg_trgm`     | Search backend: `pg_trgm` (PostgreSQL trigram, zero extra infra) or `opensearch` (managed OpenSearch cluster) |
| `OPENSEARCH_URL`         |          | —             | OpenSearch/Elasticsearch endpoint. Required when `SEARCH_ENGINE=opensearch`                                   |
| `OPENSEARCH_API_KEY`     |          | —             | OpenSearch API key. **Store in a secrets manager; never commit to source control**                            |
| `MAX_RESULTS_PER_QUERY`  |          | `50`          | Upper bound on results returned per search query to limit DB load                                             |
| `SEARCH_RATE_LIMIT_RPM`  |          | `60`          | Maximum search requests per minute per IP                                                                     |
| `CORS_ORIGIN`            |          | `http://localhost:3000` | Comma-separated allowed CORS origins for the search API                                            |
| `LOG_LEVEL`              |          | `info`        | Minimum log level: `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal`                              |

¹ `REDIS_URL` is required whenever `NODE_ENV=production` — see [§2.4](#24-shared-rate-limiting-redis_url).

### 11.4 Health check endpoint

```
GET http://localhost:3003/health/ready
```

The service is ready when its database connection and Redis connection are
healthy, and the initial index build is complete:

```json
{
  "status": "ready",
  "checks": {
    "database": { "status": "up", "latencyMs": 5 },
    "redis": { "status": "up" },
    "index": { "status": "ready", "documentCount": 12450 }
  }
}
```

### 11.5 Docker Compose snippet

Add the following service to `docker-compose.yml` once `services/search`
is implemented:

```yaml
search:
  build:
    context: services/search
    dockerfile: Dockerfile
  restart: unless-stopped
  depends_on:
    postgres-search:
      condition: service_healthy
    redis:
      condition: service_healthy
    indexer:
      condition: service_healthy
  environment:
    DATABASE_URL: postgresql://linkora:${POSTGRES_PASSWORD}@postgres-search:5432/linkora_search
    REDIS_URL: redis://redis:6379
    INDEXER_URL: http://indexer:3000
    INDEXER_WS_URL: ws://indexer:3000/ws
    NODE_ENV: production
  ports:
    - "3003:3003"
  healthcheck:
    test: ["CMD-SHELL", "curl -f http://localhost:3003/health/ready || exit 1"]
    interval: 15s
    timeout: 5s
    retries: 3
    start_period: 60s  # Allow time for the initial index build
```

### 11.6 Scaling notes

- **Stateless** for the `pg_trgm` backend — all search state is in PostgreSQL.
  Scale replicas freely behind a load balancer.
- For the `opensearch` backend, scale replicas freely; OpenSearch handles
  distributed indexing internally.
- The real-time indexer WebSocket subscriber should run on one primary replica.
  Use Redis pub/sub to distribute update notifications to other replicas.
- Tune `MAX_RESULTS_PER_QUERY` and `SEARCH_RATE_LIMIT_RPM` to protect the
  PostgreSQL database from expensive full-text scans under high traffic.
- `REDIS_URL` is mandatory in production and must point at the same endpoint as
  all other services to share the rate-limit store.

## 12. Release artifact provenance and verification

Keep one record per artifact and deployed target in the deployment run or change
record. For service images, the build sources are
[Release — Docker Images](../.github/workflows/release-docker.yml) (Docker Hub
indexer, DM relay and analytics oracle) and the
[Publish Docker Images](../.github/workflows/publish-images.yml) and
[Publish Services](../.github/workflows/publish-services.yml) workflows (GHCR
notification, search and media). For the Linkora contract WASM, see
[Deploy Testnet](../.github/workflows/deploy-testnet.yml) and
[its deployment script](../scripts/deploy_testnet.sh).

### Sample deployment records

Replace the angle-bracket placeholders with values from the actual build and
deployment. The image and WASM can have different source commits and build runs.

```yaml
- artifact: container-image
  image: linkora/indexer
  release_tag: v1.2.3
  digest: "sha256:<registry-manifest-or-index-sha256>"
  source_commit: "<full-image-build-checkout-sha>"
  build_run: "https://github.com/<owner>/<repo>/actions/runs/<image-run-id>"
  environment: production
  deployed_target: "<kube-context>/<namespace>/deployment/linkora-indexer"

- artifact: soroban-wasm
  file: linkora_contracts.wasm
  source_ref: release/v1.2.3
  digest: "sha256:<wasm-file-sha256>"
  source_commit: "<full-wasm-build-checkout-sha>"
  build_run: "https://github.com/<owner>/<repo>/actions/runs/<deploy-run-id>"
  environment: testnet
  contract_id: "<deployed-Stellar-contract-ID>"
```

### Verify an image

1. Open the publishing run for the image. Copy the run URL, the full commit
   SHA used by the checkout step and the tag from the build-and-push step.
   For manual publishes, use the checked-out commit shown in the run.
2. Copy the pushed manifest or image-index digest from the build-and-push
   output. Run `docker buildx imagetools inspect IMAGE@sha256:DIGEST` to
   confirm that the registry serves it. Inspecting a tag shows where that tag
   points now. For a multi-platform image, the top-level digest identifies
   the index, and its manifest list identifies each platform digest. Where
   available, compare the image's `org.opencontainers.image.revision` label
   with the build checkout SHA.
3. Copy the actual environment and target from the deployment record. In
   Kubernetes, read the workload image reference and the running Pods'
   `status.containerStatuses[].imageID` in that context and namespace. In
   Compose, use `docker compose ps -q SERVICE` on the deployed host, then
   inspect that container and its image's `RepoDigests`. Compare like
   digests. A runtime can report a platform manifest or image config ID
   while the deployment pins the index. Use the registry's manifest list
   and platform manifest to trace those values to the recorded digest.

### Verify Soroban WASM

1. In the deployment run, copy the run URL, checkout SHA and triggering
   ref. After the build and before upload, run
   `sha256sum packages/contracts/contracts/linkora-contracts/target/wasm32v1-none/release/linkora_contracts.wasm`
   from the repo root. Record the hash with the `sha256:` prefix and retain
   the exact file or the hash in the deployment evidence. If deploying a
   different build output, hash the file passed to `--wasm`.
2. Copy `network` and `contract_id` from the run summary or the uploaded
   `contract-id.json`. The deployment job's GitHub environment is
   `production`, while its configured Stellar network is `testnet`. Use
   the Stellar network as the WASM deployment environment in the record.
   The current contract-ID artifact contains deployment metadata. Capture
   the WASM hash separately at build time.
3. On the recorded network, look up the contract instance by its ID in
   Stellar RPC and read the WASM hash from its executable. Compare the hex
   hash with the recorded file digest. For an upgraded contract, verify
   against the record for the upgrade currently on-chain. If the script
   was given an existing `CONTRACT_ID`, use that deployment’s provenance
   record. The script skips the WASM build and deployment in that case.

---

## 13. Preview Environment Smoke Test

Run these checks against the same deployed revision before promoting a preview.
Record the preview URL, deployed commit or image digest, UTC start and end times,
Stellar network, and contract ID in the promotion record.

### 13.1 Required configuration

| Component | Required configuration                                                                                                                                                                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web build | Preview values for `NEXT_PUBLIC_INDEXER_URL`, `NEXT_PUBLIC_SOROBAN_RPC_URL`, `NEXT_PUBLIC_NETWORK_PASSPHRASE`, and `NEXT_PUBLIC_CONTRACT_ID`. Set `NEXT_PUBLIC_INDEXER_API_URL` to the preview indexer when checking search.                                     |
| Indexer   | Preview `DATABASE_URL` with migrations applied, `STELLAR_RPC_URL`, matching `CONTRACT_ID`, and `START_LEDGER` at the contract deployment ledger. Apply the Redis requirements in [§2.4](#24-shared-rate-limiting-redis_url).                                     |
| Reviewer  | Read-only access to the preview indexer database, a known fixture profile with expected public fields, and a recent indexed event or a planned preview fixture event with a known ledger and transaction hash. Agree on a maximum catch-up time before starting. |

### 13.2 Verification and evidence

| Check             | What to do and capture                                                                                                                                                                                                                                                                                                                           | Sample outcome                                                                                                                                                                                                                                  | Failure owner and logs                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser           | In a clean session open the preview, navigate to `/feed` and the fixture profile, and reload both pages. Capture browser version, route, HTTP status, a screenshot of the fixture, and any failed request or uncaught exception. Check that requests use the preview backends.                                                                   | Pass when the feed renders seeded content, the profile displays the expected username, and both routes reload without an uncaught error. Fail if a route falls back to a localhost backend or renders an error.                                 | Web owner checks browser Console and Network plus preview hosting build/runtime logs. Send indexer HTTP failures to the indexer owner with the request ID if available.     |
| Indexer freshness | Check `/health/ready` and the stream/backfill fields on `/health`. Capture the RPC `getLatestLedger` sequence, the committed cursor before and after the fixture, and the fixture's presence in the relevant API or indexed projection.                                                                                                          | Pass when readiness returns 200 and the fixture at ledger 125040 appears within the agreed window with cursor ≥ 125040. Fail if readiness returns 200 but the known event never appears. A quiet contract can have a cursor below the RPC head. | Indexer owner checks ingestion, backfill and database logs using the fixture ledger and transaction hash. Escalate an unavailable or stalled RPC to the RPC operator.       |
| Contract read     | Use [`LinkoraClient.getProfile`](../packages/sdk/src/client.ts) with the preview RPC URL, network passphrase and contract ID, and pass the fixture's Stellar address. The [generated client](../packages/sdk/src/generated/client.ts) simulates the call. Capture the method, fixture address, public field comparison and any simulation error. | Pass when the expected fixture username is returned. Fail on a null fixture, mismatched value or RPC simulation error.                                                                                                                          | Contract deployment owner checks the deployment workflow, network and contract ID, fixture setup and simulation error. Escalate RPC transport failures to the RPC operator. |

Sample the [committed cursor](../services/indexer/migrations/006_indexer_cursor.sql)
on the preview indexer database with a read-only role. The stream ID is the
contract ID configured by the [indexer entry point](../services/indexer/src/index.ts).

```bash
psql "$PREVIEW_INDEXER_READONLY_DSN" -v ON_ERROR_STOP=1 -v contract_id="$CONTRACT_ID" <<'SQL'
SELECT id, processed_cursor, updated_at
FROM indexer_cursor
WHERE id = :'contract_id';
SQL
```

Record pass or fail for each check, attach redacted evidence, and assign any
failed check to the owner above. Repeat failed checks after remediation and
record the results before promotion. Remove credentials, cookies, and auth
headers from screenshots, logs, and browser exports.
