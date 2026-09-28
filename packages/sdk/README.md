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

## ProfileClient — profile methods

All profile operations are available directly on the `LinkoraClient` instance. There is no
separate `ProfileClient` class — the methods are part of `LinkoraClient`, which extends the
generated base client.

```ts
import { LinkoraClient } from "linkora-sdk";

const client = new LinkoraClient({
  contractId: "CCNZILBYJQBX...",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
});
```

---

### `getProfile(address)`

Fetch a user profile by Stellar address.

**Signature:**

```ts
getProfile(address: string): Promise<Profile | null>
```

**Parameters:**

| Name      | Type     | Description                            |
| --------- | -------- | -------------------------------------- |
| `address` | `string` | Stellar public key (`G…`) of the user. |

**Returns:** `Promise<Profile | null>` — the `Profile` object, or `null` if the profile
does not exist or has expired (storage rent unpaid).

**Errors thrown:**

| Error class         | When                                                             |
| ------------------- | ---------------------------------------------------------------- |
| `InvalidInputError` | `address` is not a valid Stellar public key or contract address. |
| `NetworkError`      | RPC request failed.                                              |
| `SimulationError`   | Contract simulation failed for an unexpected reason.             |

**Example:**

```ts
const profile = await client.getProfile("GBFOY2LJQZ...");
if (profile) {
  console.log(`Username: ${profile.username}`);
  console.log(`Creator token: ${profile.creator_token}`);
} else {
  console.log("Profile not found.");
}
```

---

### `setProfile(user, username, creatorToken)`

Build a `set_profile` transaction XDR. Creates a new profile or updates an existing one.

> **Note:** This method returns a base64 XDR string built with a throwaway keypair. It is
> not directly submittable. Pass the result to `TransactionQueue` or use
> `prepareTransaction` to build a submittable envelope.

**Signature:**

```ts
setProfile(user: string, username: string, creatorToken: string): string
```

**Parameters:**

| Name           | Type     | Description                                                               |
| -------------- | -------- | ------------------------------------------------------------------------- |
| `user`         | `string` | Stellar public key of the profile owner. Must be the transaction signer.  |
| `username`     | `string` | Unique display name (1–50 characters). Must not be taken by another user. |
| `creatorToken` | `string` | Contract ID of the user's SEP-41 creator token.                           |

**Returns:** `string` — base64-encoded transaction XDR (throwaway source, not directly submittable).

**Errors thrown:**

| Error class         | When                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| `InvalidInputError` | `user` or `creatorToken` is not a valid address, or `username` is empty. |
| `ValidationError`   | `username` or `creatorToken` fails format validation.                    |

**Example:**

```ts
// Build the XDR and enqueue it for submission
const xdr = client.setProfile("GBFOY2LJQZ...", "alice", "CABC123DEF...");

queue.enqueue(xdr);
await queue.run();
```

**Submittable variant:** If you need a fully prepared transaction (with correct sequence
number and footprint), use `prepareTransaction` directly:

```ts
const sourceAccount = await client.getAccountForTx("GBFOY2LJQZ...");
const tx = await client.prepareTransaction(
  "set_profile",
  sourceAccount
  // scvAddress, scvString, scvAddress for user/username/creatorToken
);
const xdrEnvelope = tx.toEnvelope().toXDR("base64");
// Sign xdrEnvelope with your wallet and submit
```

---

### `deleteProfile(user)`

Build a `delete_profile` transaction XDR. Deletes the caller's profile and places a
tombstone for lazy storage cleanup.

**Signature:**

```ts
deleteProfile(user: string): string
```

**Parameters:**

| Name   | Type     | Description                              |
| ------ | -------- | ---------------------------------------- |
| `user` | `string` | Stellar public key of the profile owner. |

**Returns:** `string` — base64-encoded transaction XDR (throwaway source, not directly submittable).

**Errors thrown:**

| Error class         | When                                   |
| ------------------- | -------------------------------------- |
| `InvalidInputError` | `user` is not a valid Stellar address. |

**Example:**

```ts
const xdr = client.deleteProfile("GBFOY2LJQZ...");
queue.enqueue(xdr);
await queue.run();
```

---

### `getProfileCount()`

Get the total number of profiles ever registered. This counter is never decremented on
profile deletion.

**Signature:**

```ts
getProfileCount(): Promise<bigint>
```

**Returns:** `Promise<bigint>` — cumulative profile creation count.

**Example:**

```ts
const count = await client.getProfileCount();
console.log(`Total registered users: ${count.toString()}`);
```

---

### `getAddressByUsername(username)`

Resolve a username to its owner's Stellar address. Use this to look up profiles by name.

> **Note:** The contract does not expose a full-text search endpoint. For searching
> profiles by partial username, use the indexer's REST API instead.

**Signature:**

```ts
getAddressByUsername(username: string): Promise<string | null>
```

**Parameters:**

| Name       | Type     | Description                                     |
| ---------- | -------- | ----------------------------------------------- |
| `username` | `string` | The exact username to look up (case-sensitive). |

**Returns:** `Promise<string | null>` — the owner's Stellar public key, or `null` if the
username is not registered.

**Errors thrown:**

| Error class         | When                                          |
| ------------------- | --------------------------------------------- |
| `InvalidInputError` | `username` is empty or exceeds 50 characters. |
| `NetworkError`      | RPC request failed.                           |

**Example:**

```ts
// Look up by username, then fetch the full profile
const address = await client.getAddressByUsername("alice");
if (address) {
  const profile = await client.getProfile(address);
  console.log(`alice's address: ${address}`);
  console.log(`Creator token: ${profile?.creator_token}`);
} else {
  console.log("Username not found.");
}
```

---

### `Profile` type

```ts
interface Profile {
  address: string; // Stellar public key of the owner
  username: string; // Unique display name
  creator_token: string; // Contract ID of the creator's SEP-41 token
}
```

---

### Error types reference

All profile methods throw errors from the SDK error hierarchy. The most common ones:

| Class               | Code                | When                                                     |
| ------------------- | ------------------- | -------------------------------------------------------- |
| `InvalidInputError` | `INVALID_INPUT`     | Bad address format, empty string, or out-of-range value. |
| `ValidationError`   | `VALIDATION_ERROR`  | Structural validation failed (e.g., wrong type).         |
| `NotFoundError`     | `NOT_FOUND`         | Profile, username, or resource does not exist on-chain.  |
| `NetworkError`      | `NETWORK_ERROR`     | RPC connection or timeout failure.                       |
| `SimulationError`   | `SIMULATION_FAILED` | Contract simulation returned an error.                   |

Import them from `linkora-sdk`:

```ts
import { NotFoundError, InvalidInputError, NetworkError, SimulationError } from "linkora-sdk";

try {
  const profile = await client.getProfile("GBFOY2...");
} catch (err) {
  if (err instanceof NotFoundError) {
    console.log("Profile does not exist.");
  } else if (err instanceof NetworkError) {
    console.log("RPC unavailable, try again later.");
  } else {
    throw err;
  }
}
```
