For ledger progress and projection terminology, see the [data freshness glossary](./DATA_FRESHNESS.md).

# Indexer gossip protocol

Indexer nodes compare their latest ledger state roots with peers configured in
`INDEXER_PEERS`, a comma-separated list of HTTP or HTTPS base URLs. Invalid
entries and duplicate URLs are ignored during startup. Each polling cycle reads
the local root, requests each peer's root for the same ledger, and counts fresh
disagreements toward `DIVERGENCE_THRESHOLD`.

Peer observations are keyed by peer URL, ledger sequence, and root hash. The
same observation is handled once during `GOSSIP_MESSAGE_TTL_MS` (30 seconds by
default), which prevents duplicate announcements from being counted or logged
repeatedly. The cache removes expired entries and is capped at 10,000 records.
Changing a peer's root or ledger creates a new observation immediately.

When enough peers disagree, the node self-fences and stops serving API traffic.
If RPC reconciliation dependencies were supplied, it locates the first
diverging ledger, replays the missing range, and resumes after successful
reconciliation. `GOSSIP_INTERVAL_MS` controls polling and
`DIVERGENCE_THRESHOLD` controls the number of agreeing peer observations needed
to fence.

Unit coverage for peer parsing, deduplication expiry, divergence detection,
self-fencing, and the stream circuit breaker lives under
`services/indexer/src/__tests__/`.

## Checkpoint recovery

The ingestion checkpoint is `indexer_cursor.processed_cursor`, keyed by
`CONTRACT_ID`. The [pipeline](../../services/indexer/src/pipeline.ts) commits raw
events, domain projections, and the cursor in one transaction. The cursor tracks
the highest committed event ledger. Empty ledgers do not advance it.
`indexer_state` stores state roots for gossip and is updated after commit.

### Pause and resume

Stop the worker gracefully and keep its database, contract, RPC network, and
`START_LEDGER` configuration. Restart using the same deployment command. The
[startup runner](../../services/indexer/src/index.ts) reads the committed cursor
`C` and attempts startup backfill from `C + 1` when it detects a gap. The live
poller also uses the configured start ledger, so review that setting and startup
logs for RPC history or backfill-limit errors. Startup can continue when full
gap recovery fails.

**Expected results** — The persisted checkpoint begins at `C` and advances as
new event batches commit. Immediately after restart, previously committed posts
remain queryable. Once caught up, a known post created during the pause appears
once and its tip and like totals match the source events.

### Replay from a selected checkpoint

Choose a completed ledger `C` and restore a consistent database snapshot taken
through that ledger into a separate recovery database. The snapshot must include
the cursor, raw events, projections, and state-root data from the same point.
Check that the RPC can serve events starting at `C + 1`, then run a single
indexer against the restored database with external delivery integrations
disabled. For a full rebuild, use a fresh migrated database and set the first
replay ledger to the earliest required contract event instead.

Changing `START_LEDGER` sets the RPC polling start. It does not reset stored
state. A cursor-only rewind leaves projections and raw events in place, and
raw-event deduplication alone does not prevent the pipeline from calling domain
handlers again.

Example for an isolated recovery shell, from the repository root. Replace
`RECOVERY_DATABASE_URL`, `RECOVERY_RPC_URL`, and `RECOVERY_CONTRACT_ID` with
values for the recovery database and the original event stream. Set
`FIRST_REPLAY_LEDGER` to the numeric value of `C + 1`, or to the first required
ledger for a full rebuild. See the [migration guide](../../services/indexer/migrations/README.md#starting-the-indexer)
for database setup.

```sh
DATABASE_URL="${RECOVERY_DATABASE_URL:?set the recovery database URL}" \
STELLAR_RPC_URL="${RECOVERY_RPC_URL:?set the RPC URL for the same network}" \
CONTRACT_ID="${RECOVERY_CONTRACT_ID:?set the source contract ID}" \
START_LEDGER="${FIRST_REPLAY_LEDGER:?set the first numeric replay ledger}" \
PORT=3101 pnpm --filter @linkora/indexer dev
```

**Expected results** — Before startup the restored cursor is `C`, or the row is
absent in a fresh database (the pipeline reads zero). As replay commits, the
cursor reaches the highest processed event ledger. A post present in the
snapshot is queryable before replay. A known post first created after `C`
returns HTTP 404 before its batch is applied and HTTP 200 afterward.

### Verify projection consistency

Run these read-only checks after recovery. Set `CHECK_DATABASE_URL` to the
database being verified, `CHECK_CONTRACT_ID` to the indexed contract,
`CHECK_API_URL` to that same instance's HTTP base URL (for example
`http://127.0.0.1:3101` in the recovery shell), and `CHECK_POST_ID` to a
known numeric post ID.

```sh
psql "${CHECK_DATABASE_URL:?set database URL}" \
  -v ON_ERROR_STOP=1 -v contract_id="${CHECK_CONTRACT_ID:?set contract ID}" <<'SQL'
SELECT processed_cursor FROM indexer_cursor WHERE id = :'contract_id';
SELECT ledger_sequence, event_index, count(*)
FROM raw_events
WHERE contract_id = :'contract_id'
GROUP BY ledger_sequence, event_index
HAVING count(*) > 1;
SQL

curl -i "${CHECK_API_URL:?set indexer base URL}/api/posts/${CHECK_POST_ID:?set post ID}"
```

**Expected results** — The cursor reaches the last known event ledger in the
range being verified, and the duplicate query returns zero rows. Compare the
[post response](../../services/indexer/src/api/routes/posts.ts) with the source
events or a trusted projection at the same ledger. Check the post ID, author,
content, deletion status, `tip_total`, and `like_count`. A cursor at the
expected ledger with a missing post or mismatched totals is a failed consistency
check.
