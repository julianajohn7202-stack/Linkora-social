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

---

## PostClient

Post operations are exposed directly on `LinkoraClient`. This section covers creating and deleting posts on-chain, and querying the post feed from the off-chain indexer.

### Methods

| Method                                              | Type                  | Description                                                |
| --------------------------------------------------- | --------------------- | ---------------------------------------------------------- |
| `createPost(author, content)`                       | Write (throwaway XDR) | Builds a `create_post` operation XDR                       |
| `prepareCreatePostTx(author, content, horizonUrl?)` | Write (submittable)   | Fetches real sequence, simulates, returns wallet-ready XDR |
| `deletePost(author, postId)`                        | Write (throwaway XDR) | Builds a `delete_post` operation XDR                       |
| `getPost(postId)`                                   | Read                  | Returns a `Post` object or `null`                          |
| `getPostCount()`                                    | Read                  | Returns the total number of posts as `bigint`              |
| `getPostsByAuthor(author, offset, limit)`           | Read                  | Returns an array of post IDs by author                     |
| `getLikeCount(postId)`                              | Read                  | Returns the like count for a post                          |

### FeedOptions interface

The indexer's feed endpoint accepts the following query parameters. Pass them when calling `/api/feed` or `/api/feed/following/:address`:

| Field    | Type               | Default | Description                                                                                            |
| -------- | ------------------ | ------- | ------------------------------------------------------------------------------------------------------ |
| `limit`  | `number`           | `20`    | Number of posts to return (max 100)                                                                    |
| `offset` | `number`           | `0`     | Number of posts to skip (for offset pagination)                                                        |
| `viewer` | `string`           | —       | Stellar address of the requesting user; filters out posts from blocked accounts                        |
| `cursor` | `string \| number` | —       | Opaque cursor for cursor-based pagination (explore feed: numeric score; following feed: ISO timestamp) |
| `tag`    | `string`           | —       | Filter posts by a single hashtag (case-insensitive)                                                    |

The response shape for all feed endpoints:

```ts
{
  posts: Post[];       // array of post objects
  total: number;       // total matching rows (offset feed) or posts.length (cursor feed)
  limit: number;       // echoed from request
  offset: number;      // echoed from request (offset feed only)
  has_more: boolean;   // true when more pages are available
  next_cursor?: any;   // next cursor value (cursor feed only)
}
```

### Examples

#### createPost — build operation XDR for server-side queue

```ts
import { LinkoraClient } from "linkora-sdk";

const client = new LinkoraClient({
  contractId: "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  rpcUrl: "https://soroban-testnet.stellar.org",
});

// Returns throwaway XDR — pass to TransactionQueue or buildMultiOpTx, not directly to wallet
const opXdr = client.createPost("GBFOY...", "Hello, Soroban!");
console.log("Operation XDR:", opXdr);
```

#### prepareCreatePostTx — wallet-ready transaction

```ts
// Returns a fully simulated XDR with the real account sequence
const txXdr = await client.prepareCreatePostTx("GBFOY...", "Hello, Soroban!");
// Pass txXdr to Freighter or another Stellar wallet for signing
```

#### deletePost

```ts
const opXdr = client.deletePost("GBFOY...", 42n);
console.log("Delete Post Op XDR:", opXdr);
```

#### getFeed — offset pagination via the indexer REST API

```ts
const response = await fetch(
  "https://indexer.linkora.example/api/feed?limit=20&offset=0&viewer=GBFOY..."
);
const { posts, has_more } = await response.json();
```

#### getFeed — cursor-based explore feed

```ts
// First page
const first = await fetch("https://indexer.linkora.example/api/feed/explore?limit=20");
const { posts, next_cursor } = await first.json();

// Next page — pass next_cursor as cursor
const second = await fetch(
  `https://indexer.linkora.example/api/feed/explore?limit=20&cursor=${next_cursor}`
);
```

#### getFeed — following feed with tag filter

```ts
const response = await fetch(
  "https://indexer.linkora.example/api/feed/following/GBFOY...?limit=20&tag=defi"
);
const { posts } = await response.json();
```
