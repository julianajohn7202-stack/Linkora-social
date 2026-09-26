# linkora-sdk

Typed TypeScript client for `LinkoraContract` on Stellar.

## Transaction retries: exponential backoff with jitter

`TransactionQueue` submits transactions through the Soroban RPC with a retry
policy designed to survive network congestion without making it worse. Instead
of fixed-interval retries — which cause every client to hit the network in
lockstep (a "thundering herd") — failed submissions are retried with
**exponential backoff and jitter**, bounded by a **circuit breaker**.

### Behavior

- **Exponential backoff** — the delay between retries grows as
  `baseDelayMs * 2^attempt`, capped at `maxDelayMs`.
- **Jitter** — a random `0 … jitterFactor * delay` is added to each delay so
  concurrent retriers spread out instead of retrying in sync.
- **Retry-After** — `429` (rate-limited) responses that carry a `Retry-After`
  header (delta-seconds or HTTP-date) are honored; that delay takes precedence
  over the computed backoff (still bounded by `maxDelayMs`).
- **Circuit breaker** — after `circuitBreakerThreshold` consecutive retryable
  failures the breaker opens, the queue is paused, and a `CircuitBreakerError`
  is thrown so callers can report the endpoint as unhealthy.
- **Permanent failures are not retried** — a submission the RPC rejects outright
  (`ERROR` status) fails fast rather than consuming retry budget.
- **Structured logging** — every retry decision is reported to an optional
  `logger` with the attempt number, delay, and reason
  (`error` | `rate-limited` | `circuit-open` | `exhausted`).

### Configuration

Retry tunables default to the environment, and can be overridden per queue.

| Environment variable                 | Default | Meaning                                        |
| ------------------------------------ | ------- | ---------------------------------------------- |
| `TX_RETRY_MAX_ATTEMPTS`              | `5`     | Max attempts (including the first) per submit  |
| `TX_RETRY_BASE_DELAY_MS`             | `1000`  | Base delay for the exponential term            |
| `TX_RETRY_MAX_DELAY_MS`              | `30000` | Upper bound on a single delay                  |
| `TX_RETRY_JITTER_FACTOR`             | `0.5`   | Jitter window as a fraction of the delay (0–1) |
| `TX_RETRY_CIRCUIT_BREAKER_THRESHOLD` | `5`     | Consecutive failures before the breaker opens  |

### Usage

```ts
import { TransactionQueue, ConnectionHealthMonitor } from "linkora-sdk";

const health = new ConnectionHealthMonitor(rpcUrl);

const queue = new TransactionQueue({
  signer,
  rpc,
  // Per-queue overrides (any omitted field falls back to the env defaults):
  retry: { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 30000, jitterFactor: 0.5 },
  // Surface retry telemetry + circuit-breaker health through the monitor:
  logger: (info) => health.recordRetry(info),
});

queue.enqueue(xdr1).enqueue(xdr2);

try {
  await queue.run();
} catch (err) {
  if (queue.isCircuitOpen) {
    // Endpoint is unhealthy — back off before submitting more work.
  }
  throw err;
}
```

The lower-level primitives (`backoffWithJitter`, `CircuitBreaker`,
`parseRetryAfter`, `withRetry`) are exported directly for reuse.

### Dry-run status events

`TransactionQueue` emits status events via `queue.on("status", ...)`. When run
in **dry-run** mode (`run({ dryRun: true })` or a queue-level `dryRun: true`),
each step is simulated but never submitted. The queue still emits a `confirmed`
event at the end of each step to mark it complete, but that event:

- carries `dryRun: true`, and
- has **no** `hash` (nothing was broadcast).

Consumers listening for on-chain confirmations should check the `dryRun` flag to
avoid mistaking a simulated flow for a real submission:

```ts
queue.on("status", (e) => {
  if (e.status === "confirmed") {
    if (e.dryRun) {
      // Simulated — do not show as "submitted to network".
    } else {
      // Real confirmation — e.hash is present.
    }
  }
});
```

## API Semantics

The SDK exposes two distinct paths for mutative (write) operations:

### 1. `prepare*Tx` (Submittable)

Methods like `prepareCreatePostTx`, `prepareFollowTx`, and `prepareDmKeyTx` are the **intended path for client-side applications**.
They fetch the actual account sequence from Horizon, simulate the transaction to discover footprint/fees, and return a base64-encoded `TransactionEnvelope` XDR that is fully ready to be signed (e.g. by Freighter) and submitted to the network.

```ts
const txXdr = await client.prepareCreatePostTx("GBFOY...", "Hello!");
// txXdr is ready to be passed to wallet for signing
```

### 2. Base Write Methods (Throwaway XDR)

Methods like `createPost`, `follow`, and `tip` **do not fetch sequence numbers** and return XDR built using a throwaway `Keypair`.
**These are not directly submittable.** They exist primarily to easily extract the Soroban `Operation` for batching (e.g., passing to `buildMultiOpTx`) or for server-side queueing where sequence management is handled by a background worker (like `TransactionQueue`).

If you attempt to sign and submit this XDR directly, the network will reject it with a `tx_bad_seq` error.

## Pagination

The Linkora SDK uses cursor-based pagination across its data access layers (including Soroban contract event polling, DM relay conversation history, and indexer queries). Cursor pagination ensures deterministic and stable results without missing records or producing phantom items when new transactions are written concurrently.

### Cursor Encoding and Structure

Unlike offset-based pagination (`offset`/`limit`), which degrades in performance on large datasets and experiences drift when items are inserted or deleted, cursor-based pagination uses state-derived, opaque pointers:

- **Opaque Tokens**: Cursors are exposed to consumers as opaque strings (for example, base64-encoded position vectors or compound tokens like `<ledgerSequence>-<entryIndex>`).
- **Underlying Composition**: Internally, cursors encode deterministic ordering keys such as the ledger sequence, event paging token, timestamp, or entity primary key.
- **Client Handling**: Applications should treat cursor strings as opaque values. Do not attempt to parse, decompose, or fabricate cursors manually; always supply the exact cursor string returned by previous responses.

### Forward and Backward Navigation

APIs supporting pagination allow bidirectional traversal through feeds and event streams:

- **Forward Navigation (`nextCursor` / `cursor`)**:
  - Initial fetch: Send a request with a specified `limit` and no cursor (or the initial starting point).
  - Subsequent pages: If more items exist, the response contains a `nextCursor` (or `pagingToken`). Pass this value as the `cursor` parameter for the next page request.
  - Termination: When `nextCursor` is `undefined`, `null`, or the returned item count is 0, the current end of the stream has been reached.

- **Backward Navigation (`prevCursor` / reverse order)**:
  - For historical backfilling or reading towards older activity, APIs provide a `prevCursor` or accept direction flags (such as `order: "asc" | "desc"`).
  - Supplying `prevCursor` retrieves preceding records up to the specified boundary.

### TypeScript Example: Full Paginated Loop

The following TypeScript example demonstrates how to implement a complete paginated loop using the SDK pattern, including page bounds, cursor progression, and result aggregation:

```typescript
import { LinkoraClient } from "linkora-sdk";

export interface PaginatedResult<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
}

/**
 * Fetches all available records by iterating through cursor-paginated pages.
 *
 * @param fetchPage - Async callback fetching a single page by cursor and limit
 * @param pageSize - Number of records requested per page
 * @param maxRecords - Maximum total records to collect (defaults to Infinity)
 * @returns Combined array of all fetched records
 */
export async function fetchAllPages<T extends { id: string }>(
  fetchPage: (cursor?: string, limit?: number) => Promise<PaginatedResult<T>>,
  pageSize: number = 50,
  maxRecords: number = Infinity
): Promise<T[]> {
  const aggregated: T[] = [];
  const seenIds = new Set<string>();
  let currentCursor: string | undefined = undefined;
  let hasMore = true;

  while (hasMore && aggregated.length < maxRecords) {
    const batchLimit = Math.min(pageSize, maxRecords - aggregated.length);
    const page = await fetchPage(currentCursor, batchLimit);

    if (!page.items || page.items.length === 0) {
      break;
    }

    for (const item of page.items) {
      // Deduplicate items that may overlap page boundaries
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        aggregated.push(item);
      }
    }

    currentCursor = page.nextCursor;
    hasMore = Boolean(page.hasMore && currentCursor);
  }

  return aggregated;
}

// Example usage:
// const allMessages = await fetchAllPages(
//   (cursor, limit) => relay.getMessages(conversationId, limit, cursor),
//   50,
//   500
// );
```

### Deduplication and Cursor Invalidation

When consuming cursor-paginated endpoints in distributed or real-time environments:

- **Client-Side Deduplication**:
  - Concurrent ledger closes and polling retries across replicas can result in boundary overlap.
  - Always maintain a local deduplication set (e.g. keyed by transaction hash, event id, or composite key `address:seq`) before appending items to local state or UI stores.
- **Cursor Invalidation and Expiration**:
  - On-chain nodes and RPC clusters enforce retention horizons (pruning historical ledger state).
  - If a cursor points to a ledger or partition that has expired or been pruned, the server responds with a cursor error (e.g. `410 Gone` or `INVALID_CURSOR`).
  - Handling invalidation: When an invalidation error occurs, reset your stored cursor, fall back to the earliest available retention ledger or live network head, and initiate a gap reconciliation or backfill cycle.
- **Persistent State with `CursorStore`**:
  - For background pollers and long-lived client workers, persist cursors across restarts using the SDK's `CursorStore` implementations (`MemoryCursorStore`, `LocalStorageCursorStore`, `SecureStoreCursorStore`).
