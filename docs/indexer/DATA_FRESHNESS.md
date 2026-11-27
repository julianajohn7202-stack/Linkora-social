# Indexer data freshness glossary

Use the same network, contract ID, and observation window when comparing
these signals. Ledger sequences measure progress in ledgers. Timestamps
measure elapsed wall-clock time.

| Term                             | Meaning                                                                                                        | Where to read it                                                                                                                                                                                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chain head                       | Latest closed ledger reported by the configured Stellar RPC.                                                   | Call `getLatestLedger` and read `result.sequence`, as the [startup gap check](../../services/indexer/src/index.ts) does.                                                                                                                                                |
| Indexed ledger                   | Highest event ledger recorded in the committed cursor for the contract stream.                                 | Query `indexer_cursor.processed_cursor` for the contract ID, using the same key as [`readCursor`](../../services/indexer/src/pipeline.ts). Event-free ledgers may leave this value unchanged. The cursor alone cannot establish that all earlier ranges were recovered. |
| Visible projection               | Derived state returned by the read path a client actually uses. Its freshness depends on the entity and query. | For a post, call [`GET /api/posts/{id}`](../../services/indexer/src/api/routes/posts.ts) and check the expected fields. `created_ledger` measures when the post was created. Check the relevant fields for later updates.                                               |
| Time since last successful write | Wall-clock age of the latest committed cursor write for the stream.                                            | Calculate `now() - indexer_cursor.updated_at` for the same contract ID. The [pipeline](../../services/indexer/src/pipeline.ts) updates the timestamp in the batch transaction, including on a replay that rewrites the existing cursor.                                 |

The readiness response exposes `checks.event_stream.lastEventAgo` as a
process-local signal. [The batch callback](../../services/indexer/src/index.ts)
records it after successful processing of a nonempty batch, and the
[health monitor](../../services/indexer/src/services/health-monitor.ts)
shows `n/a` until the first such batch after startup.

## Worked example

Suppose the RPC reports ledger **120,050**, the stream cursor is **120,042**,
and the cursor timestamp is **12:00:30 UTC** when sampled at **12:01:00 UTC**.

- The chain-head-to-indexed-ledger gap is **8 ledgers** (120,050 − 120,042).
- The last successful cursor write was **30 seconds ago**.
- If post 42 was created at ledger **120,040**, a successful
  `GET /api/posts/42` with `created_ledger` equal to 120,040 confirms that
  creation is visible. If a like at ledger 120,044 is expected to increase
  its count, verify `like_count` after the indexer catches up.

## Verification

On the target environment, compare the RPC sequence with the cursor query
below. Bind `$1` to the indexed contract ID. If there is no cursor row yet,
report the sample as unavailable. Query a known post using the same
environment's API to verify its projection.

```sql
SELECT processed_cursor, updated_at, now() - updated_at AS last_write_age
FROM indexer_cursor
WHERE id = $1;
```
