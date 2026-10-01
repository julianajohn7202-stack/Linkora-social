# Linkora API Reference

> **Scope note.** This document currently covers **HTTP request authentication** for the
> indexer's REST API. The Soroban contract function reference, storage layout, and event
> schema are not here yet — see `packages/contracts` and the README API table in the
> meantime.

---

## Table of Contents

1. [Stellar HTTP Authentication (v1)](#1-stellar-http-authentication-v1)
2. [The Signed Message](#2-the-signed-message)
3. [Canonical Path](#3-canonical-path)
4. [Body Hash](#4-body-hash)
5. [The Authorization Header](#5-the-authorization-header)
6. [Verification Order and Error Codes](#6-verification-order-and-error-codes)
7. [Worked Example](#7-worked-example)
8. [Protected Endpoints](#8-protected-endpoints)
9. [Known Limitations of v1](#9-known-limitations-of-v1)
10. [Pool Withdrawal Process](#pool-withdrawal-process)

---

## 1. Stellar HTTP Authentication (v1)

Protected endpoints authenticate the caller by an Ed25519 signature over a message derived
from the request itself. The signature commits to the HTTP method, the request path, and a
hash of the request body, so a credential captured on one endpoint cannot be replayed
against another.

The canonical implementation lives in `packages/types/src/auth.ts` (`buildAuthMessage`,
`canonicalizeAuthPath`) and is shared by the verifier and the first-party clients. External
integrators should implement the format below directly — see the
[migration guide](./MIGRATION_AUTH_V1.md) for a self-contained reference implementation.

### Why the `v1:` prefix

The message begins with a version tag so the scheme can be rotated without a flag day. A
future `v2:` can add fields (a nonce, header binding, the query string) while a server
accepts both prefixes during a transition window, routing each credential to the verifier
that matches its tag. Without the prefix, any change to the layout would require every
client and every server to cut over in the same instant.

The prefix is part of the signed bytes, so it cannot be swapped by an attacker to downgrade
a v2 credential into a v1 one.

---

## 2. The Signed Message

```
v1:{METHOD}:{canonicalPath}:{address}:{timestamp}:{bodyHash}
```

| Field           | Description                                                                |
| --------------- | -------------------------------------------------------------------------- |
| `v1`            | Literal version tag.                                                       |
| `METHOD`        | HTTP method, **upper-cased**: `GET`, `POST`, `PATCH`, `DELETE`.            |
| `canonicalPath` | Request path after canonicalisation — see [§3](#3-canonical-path).         |
| `address`       | Signer's Stellar public key (`G…`), exactly as sent in the header payload. |
| `timestamp`     | Unix epoch in **milliseconds**, as an integer with no separators.          |
| `bodyHash`      | Lowercase hex SHA-256 of the raw body — see [§4](#4-body-hash).            |

Fields are joined with a literal `:`. No field is escaped or length-prefixed. A path _can_
legitimately contain a `:` (`/api/items:batchGet` is a valid URL), so the message is not
unambiguous by construction — it is unambiguous because the last three fields have fixed
shapes (a 56-character base32 address, digits, 64 hex characters), which lets the suffix be
read unambiguously from the right no matter what the path contains.

What gets signed is the **SHA-256 digest of this message**, not the message itself:

```
signature = Ed25519_sign(privateKey, SHA256(message))
```

The digest is signed as 32 raw bytes. The signature is the raw 64-byte Ed25519 output,
base64-encoded for transport.

> **Wallet signers do not do this today.** The rule above is what the server verifies, and it
> is what a signer holding the key directly (`Keypair.sign`) produces. Browser wallets are a
> different matter: Freighter's `signBlob` treats its argument as an opaque **message**, wraps
> it in the SEP-0053 envelope and signs `SHA256("Stellar Signed Message:\n" + blob)` — never
> the 32 raw bytes. It also returns a `Buffer`, not the base64 string its TypeScript signature
> promises. Both facts are verified against a real Freighter 2.0.0 signature. Consequently the
> first-party browser client **does not currently interoperate with this server**, and
> reconciling the two is an open decision, not something this document describes as settled.
> If you sign with a wallet, expect the envelope; if you sign with a library, follow the rule
> above.

---

## 3. Canonical Path

The server canonicalises `req.originalUrl`, which always carries the **full path including
any router mount prefix**. Clients must sign the same absolute path.

The rule, in order:

1. Drop everything from the first `?` onward.
2. Strip all trailing `/`.
3. If the result is empty, use `/`.

| Raw path                 | Canonical path  |
| ------------------------ | --------------- |
| `/api/follows`           | `/api/follows`  |
| `/api/follows/`          | `/api/follows`  |
| `/api/follows//`         | `/api/follows`  |
| `/api/follows?cursor=5`  | `/api/follows`  |
| `/api/follows/?cursor=5` | `/api/follows`  |
| `/`                      | `/`             |
| `//`                     | `/`             |
| `/api//follows`          | `/api//follows` |

Two consequences worth internalising:

- Sign `/api/notifications/preferences`, never the router-relative `/preferences`. Signing
  the relative path produces a different message and the request comes back `401`.
- If your base URL carries a path segment of its own (`https://example.com/indexer`), that
  segment reaches the server as part of `req.originalUrl` but never appears in the path you
  passed to the signer. Keep the base URL an origin only, or include the prefix in the
  signed path.

---

## 4. Body Hash

`bodyHash` is the lowercase hex SHA-256 of the **exact bytes** sent as the request body.

When there is no body, hash the empty string:

```
SHA256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

This is the value used for every `GET`, and for any request sent without a body. The server
reaches the same value either way: a request with no JSON content type never triggers
body-parser's `verify` hook and its absent raw body is hashed as empty, while a JSON request
with an empty body triggers the hook with a zero-length buffer, which hashes to the same
digest.

> **Hash the bytes you send, not the object you serialised.** Serialise once into a
> variable, then use that same variable for both the hash and the request body. Serialising
> separately for each can yield different bytes — key order, whitespace, number
> formatting — and the signature would then commit to a body that was never sent, producing
> a `401` that is very hard to read.

---

## 5. The Authorization Header

```
Authorization: StellarSig <base64(JSON)>
```

The base64 payload decodes to a JSON object with exactly these three fields:

```json
{
  "address": "G...",
  "timestamp": 1735689600000,
  "signature": "<base64 of the raw 64-byte Ed25519 signature>"
}
```

The header value is the literal `StellarSig`, one space, then the base64 payload. The parser
splits on a single space and rejects anything else, so the payload must not contain spaces.

`address` and `timestamp` are sent in the clear **and** covered by the signature — the
server uses the transmitted values to rebuild the message, then checks the signature against
it. Tampering with either produces a message that no longer verifies.

---

## 6. Verification Order and Error Codes

The server checks in this order and returns on the first failure:

| Order | Check                                 | Status | Code                  |
| ----- | ------------------------------------- | ------ | --------------------- |
| 1     | Header present, parsable, all fields  | `400`  | `INVALID_AUTH_HEADER` |
| 2     | `timestamp` is not in the future      | `403`  | `INVALID_TIMESTAMP`   |
| 3     | `timestamp` is at most 30 s old       | `403`  | `EXPIRED_TIMESTAMP`   |
| 4     | Signature matches the rebuilt message | `401`  | `INVALID_SIGNATURE`   |

Errors carry the shape:

```json
{
  "error": {
    "code": "INVALID_SIGNATURE",
    "message": "Invalid signature",
    "requestId": "..."
  }
}
```

**The order matters when diagnosing a replay.** Timestamp checks run before the signature
check, so an expired credential returns `403` regardless of which path it is presented at —
you will not see the `401` that a wrong path would otherwise produce. A credential replayed
against a different path _within_ the tolerance window is what yields `401`.

The tolerance is 30 000 ms, defined by `SIGNATURE_TIMESTAMP_TOLERANCE_MS` in
`services/indexer/src/middleware/stellarAuth.ts`. Clock skew between client and server eats
directly into this budget; a client running more than 30 s fast is rejected outright as
`INVALID_TIMESTAMP`.

---

## 7. Worked Example

Every value below is reproducible — the keypair is seeded with 32 bytes of `0x07`.

```
address     GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57
method      POST
path        /api/follows
timestamp   1735689600000
body        {"followee":"GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H"}
```

Step 1 — hash the body:

```
bodyHash = 420fe3b7b804bb866cbfeb113d913ba1543099424aed7694297cc3f042ee29a9
```

Step 2 — build the message:

```
v1:POST:/api/follows:GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57:1735689600000:420fe3b7b804bb866cbfeb113d913ba1543099424aed7694297cc3f042ee29a9
```

Step 3 — digest it (base64, for inspection):

```
1bWsu8SkJG10Q5vEoWQZdo3ZIbseNrILzJmuOsP2VyM=
```

Step 4 — sign the digest and base64 the signature:

```
evOK1CFjMZSTvHtuXrxhDVImMQi9JByqzurli1avrRrEPyjvhhQHYwyAmJLvicSAgHEnOte0qXFBlafhOHjtAw==
```

Step 5 — assemble the header:

```
Authorization: StellarSig eyJhZGRyZXNzIjoiR0RWRVUzREQ0S09GRUNWNjZWSUhXRVpPWVg0WktSM1dWMjdMNDY0U0lJUE9VMklVSTNKQ1pBNTciLCJ0aW1lc3RhbXAiOjE3MzU2ODk2MDAwMDAsInNpZ25hdHVyZSI6ImV2T0sxQ0ZqTVpTVHZIdHVYcnhoRFZJbU1RaTlKQnlxenVybGkxYXZyUnJFUHlqdmhoUUhZd3lBbUpMdmljU0FnSEVuT3RlMHFYRkJsYWZoT0hqdEF3PT0ifQ==
```

Note that this example's timestamp is long past, so replaying it against a live server
returns `403 EXPIRED_TIMESTAMP`. It is for verifying your message construction, not for
testing a live endpoint.

---

## 8. Protected Endpoints

| Method | Path                             | Body |
| ------ | -------------------------------- | ---- |
| `POST` | `/api/notifications/register`    | JSON |
| `POST` | `/api/notifications/deregister`  | JSON |
| `GET`  | `/api/notifications/preferences` | none |
| `POST` | `/api/notifications/preferences` | JSON |
| `POST` | `/api/messages`                  | JSON |

All other indexer endpoints are public reads and take no `Authorization` header.

---

---

## Pool Withdrawal Process

Community pools hold tokens on-chain under a multi-signature guard: every
withdrawal, admin change, and threshold update requires at least `threshold`
current admins to sign the same transaction. This section describes how that
process works, what invariants the contract enforces, and how to drive it from
TypeScript using the SDK.

### Table of Contents

- [Overview](#overview)
- [Pool Data Model](#pool-data-model)
- [Multi-Sig Withdrawal — Step by Step](#multi-sig-withdrawal--step-by-step)
- [Managing Admins](#managing-admins)
  - [Adding an Admin](#adding-an-admin)
  - [Removing an Admin](#removing-an-admin)
- [Updating the Threshold](#updating-the-threshold)
- [Events](#events)
- [Error Reference](#error-reference)
- [TypeScript Examples](#typescript-examples)

---

### Overview

Every pool has:

- a single **token** (SEP-41 contract address) that it holds,
- a **balance** tracked on-chain and reconciled against actual token transfers,
- a list of **admins** (Stellar `G…` addresses), and
- a **threshold** — the minimum number of distinct admin signatures required to
  authorise any mutating operation (withdraw, add/remove admin, update threshold).

This is an M-of-N scheme: if a pool has 5 admins and `threshold = 3`, any 3 of
those admins must sign the same transaction before the contract will execute it.
The contract validates:

1. The `signers` array contains at least `threshold` entries.
2. Every entry in `signers` is a current admin of the pool.
3. Each signer calls `require_auth()`, so every signer's wallet must include
   a valid authorization entry in the transaction envelope.

Duplicate signers are rejected — each address may appear at most once per
invocation.

---

### Pool Data Model

```
Pool {
  token:     Address,    // SEP-41 token contract
  balance:   i128,       // current on-chain balance (stroops)
  admins:    Vec<Address>,
  threshold: u32,        // 1 ≤ threshold ≤ admins.len()
}
```

Read the current state of a pool at any time:

```ts
const pool = await client.getPool("my-pool-1");
// pool?.balance, pool?.admins, pool?.threshold
```

---

### Multi-Sig Withdrawal — Step by Step

#### 1. Check the current pool state

Before building a withdrawal, confirm the pool has enough balance and that you
know the current threshold and admin set:

```ts
const pool = await client.getPool("my-pool-1");
if (!pool) throw new Error("Pool not found");

console.log("Balance  :", pool.balance.toString());
console.log("Threshold:", pool.threshold);
console.log("Admins   :", pool.admins);
```

#### 2. Collect signers

Gather at least `pool.threshold` admin addresses that are willing to sign.
Every address in the `signers` array must:

- appear in `pool.admins`, and
- provide an authorization entry in the transaction envelope.

The contract checks both conditions and panics if either fails.

#### 3. Build the transaction

Use `preparePoolWithdrawTx` to produce a fully-simulated transaction envelope
ready for wallet signing. The first signer in the array is used as the
transaction source account:

```ts
const txXdr = await client.preparePoolWithdrawTx(
  ["GBFOY...", "GCO23..."], // signers — must meet threshold
  "my-pool-1", // pool ID
  500_000_000n, // amount in stroops (500 XLM)
  "GDX..." // recipient
);
```

#### 4. Each signer authorizes and signs

The returned `txXdr` must be authorized by every admin in `signers`. Distribute
the envelope to each co-signer and collect their `auth` entries. The exact
coordination mechanism (shared URL, a relay service, etc.) is outside the
contract — what matters is that when the transaction is finally submitted every
`require_auth()` call in the invocation tree is satisfied.

When using the Freighter browser wallet or Ledger hardware signer, each admin
passes the envelope through their wallet, which appends its authorization entry
before returning the signed XDR.

#### 5. Submit

Submit the fully-signed envelope to the Soroban RPC. Use `TransactionQueue` for
automatic retry with backoff:

```ts
import { TransactionQueue } from "linkora-sdk";

const queue = new TransactionQueue({ signer, rpc });
queue.enqueue(signedTxXdr);
await queue.run();
```

#### What the contract checks

The contract executes this sequence atomically. If any check fails the entire
transaction is rolled back:

| Check                            | Error                            |
| -------------------------------- | -------------------------------- |
| Pool exists                      | `pool not found` (panic)         |
| `signers.len() >= threshold`     | `InsufficientSigners` (115)      |
| Every signer is in `pool.admins` | `UnauthorizedSigner` (116)       |
| Signer duplicates                | `signers must be unique` (panic) |
| `pool.balance >= amount`         | `LowBalance` (117)               |

Token transfer happens **before** the on-chain balance is decremented. If the
transfer fails the balance is never modified, leaving the pool in a consistent
state.

---

### Managing Admins

Admin mutations (add, remove, threshold update) follow the same M-of-N pattern
as withdrawals: you must supply at least `threshold` current admin signatures.

#### Adding an Admin

The new admin is appended to `pool.admins`. The call panics if `new_admin` is
already an admin.

**Contract function:** `add_pool_admin(signers, pool_id, new_admin)`

```ts
// Build operation XDR (throwaway keypair — for batching or queue use)
const opXdr = client.addPoolAdmin(
  ["GBFOY...", "GCO23..."], // current admin signers (must meet threshold)
  "my-pool-1",
  "GNEW..." // address to add
);

// Or build a submittable envelope:
const txXdr = await client.prepareAddPoolAdminTx?.(
  ["GBFOY...", "GCO23..."],
  "my-pool-1",
  "GNEW..."
);
```

After success a `PoolAdminAddedEvent` is emitted.

#### Removing an Admin

The address is removed from `pool.admins`. The contract also validates that the
remaining admin count still meets the threshold — removing an admin that would
make `threshold > admins.len()` is rejected with `threshold unreachable after
removal` (panic).

**Contract function:** `remove_pool_admin(signers, pool_id, admin)`

```ts
const opXdr = client.removePoolAdmin(
  ["GBFOY...", "GCO23..."], // must meet threshold
  "my-pool-1",
  "GOUT..." // address to remove
);
```

After success a `PoolAdminRemovedEvent` is emitted.

**Important invariants:**

- You cannot remove an admin if it would leave `admins.len() < threshold`.
  Lower the threshold first (with `updatePoolThreshold`) if needed.
- The signer set must come entirely from the _current_ admin list, **including**
  the admin being removed (they may be one of the signers).

---

### Updating the Threshold

The new threshold must satisfy `1 ≤ new_threshold ≤ admins.len()`. The
operation itself requires the _current_ threshold of signatures, not the new one.

**Contract function:** `update_pool_threshold(signers, pool_id, threshold)`

```ts
const opXdr = client.updatePoolThreshold(
  ["GBFOY...", "GCO23...", "GCDE..."], // signers meeting current threshold
  "my-pool-1",
  3 // new threshold
);
```

After success a `PoolThresholdUpdatedEvent` is emitted containing both the old
and new threshold values.

---

### Events

All pool mutations emit on-chain events that the indexer captures and exposes
over the REST/WebSocket API.

| Event                       | Emitted by              | Key fields                                  |
| --------------------------- | ----------------------- | ------------------------------------------- |
| `PoolCreatedEvent`          | `create_pool`           | `pool_id`, `token`, `admins`, `threshold`   |
| `PoolDepositEvent`          | `pool_deposit`          | `pool_id`, `depositor`, `amount`            |
| `PoolWithdrawEvent`         | `pool_withdraw`         | `pool_id`, `recipient`, `amount`            |
| `PoolAdminAddedEvent`       | `add_pool_admin`        | `pool_id`, `new_admin`                      |
| `PoolAdminRemovedEvent`     | `remove_pool_admin`     | `pool_id`, `admin`                          |
| `PoolThresholdUpdatedEvent` | `update_pool_threshold` | `pool_id`, `old_threshold`, `new_threshold` |

Subscribe to pool events using the SDK event subscriber:

```ts
import { LinkoraEventSubscriber } from "linkora-sdk";

const sub = new LinkoraEventSubscriber({ rpcUrl, contractId });

sub.on("pool_withdraw", (event) => {
  console.log(`Pool ${event.pool_id}: withdrew ${event.amount} to ${event.recipient}`);
});

await sub.start();
```

---

### Error Reference

| Code | Name                  | Cause                                                        |
| ---- | --------------------- | ------------------------------------------------------------ |
| 112  | `PoolNotFound`        | No pool exists with the given `pool_id`                      |
| 113  | `PoolExists`          | `create_pool` called with a `pool_id` that is already in use |
| 114  | `InvalidThreshold`    | `threshold` is 0 or exceeds the number of admins             |
| 115  | `InsufficientSigners` | `signers.len() < pool.threshold`                             |
| 116  | `UnauthorizedSigner`  | A signer address is not in `pool.admins`                     |
| 117  | `LowBalance`          | Requested withdrawal amount exceeds `pool.balance`           |
| 130  | `PoolAdminNotFound`   | Attempted to remove an address not in `pool.admins`          |
| 131  | `PoolAdminExists`     | Attempted to add an address already in `pool.admins`         |

---

### TypeScript Examples

The examples below use `LinkoraClient` from `linkora-sdk` and assume the client
has already been constructed with a valid RPC URL and contract ID.

#### Full withdrawal flow

```ts
import { LinkoraClient, TransactionQueue } from "linkora-sdk";

const client = new LinkoraClient({
  rpcUrl: "https://soroban-testnet.stellar.org",
  contractId: "CABC123...",
  networkPassphrase: "Test SDF Network ; September 2015",
});

// 1. Read current pool state
const pool = await client.getPool("creator-fund");
if (!pool) throw new Error("Pool not found");

const SIGNERS = ["GBFOY...", "GCO23..."]; // must have at least pool.threshold entries

// 2. Build the transaction envelope
const txXdr = await client.preparePoolWithdrawTx(
  SIGNERS,
  "creator-fund",
  1_000_000_000n, // 100 XLM in stroops
  "GREC..." // recipient
);

// 3. Each signer authorizes (pseudo-code — real auth depends on wallet)
const signedByFirst = await walletA.sign(txXdr);
const fullySignedXdr = await walletB.addAuth(signedByFirst);

// 4. Submit with retry
const queue = new TransactionQueue({ signer: noopSigner, rpc });
queue.enqueue(fullySignedXdr);

queue.on("status", (e) => {
  if (e.status === "confirmed") {
    console.log("Withdrawal confirmed. Tx hash:", e.hash);
  }
});

await queue.run();
```

#### Rotating the admin set (remove old, add new)

```ts
// Lower the threshold first if needed to make room
const lowerThresholdOp = client.updatePoolThreshold(["GBFOY...", "GCO23..."], "creator-fund", 1);

// Remove the outgoing admin
const removeOp = client.removePoolAdmin(
  ["GBFOY..."], // threshold is now 1
  "creator-fund",
  "GOUT..."
);

// Add the replacement
const addOp = client.addPoolAdmin(["GBFOY..."], "creator-fund", "GNEW...");

// Raise the threshold back
const raiseThresholdOp = client.updatePoolThreshold(["GBFOY...", "GNEW..."], "creator-fund", 2);
```

Each of the above returns base64 operation XDR suitable for batching into a
single `buildMultiOpTx` call or submitting individually through `TransactionQueue`.

---

## 9. Known Limitations of v1

The signature covers the method, the canonical path, and the body. Everything else about the
request — headers, query string, transport — is outside it. Three consequences deserve to be
stated plainly.

### 9.1 The query string is not signed

Canonicalisation strips everything after `?` before signing, so query parameters are **not**
authenticated. A credential captured for `/api/posts?limit=10` is equally valid for
`/api/posts?limit=1000` within the tolerance window.

No currently protected endpoint reads query parameters, so there is nothing to tamper with
today. That is a property of the current route set, not a guarantee of the scheme — **do not
add a query parameter to a protected endpoint** without moving it into the body or extending
the scheme to `v2`.

### 9.2 There is no nonce — identical replay stays possible

The scheme binds a credential to _a_ request shape, not to _one_ delivery of it. Anyone who
observes a request can resend it byte-for-byte — same method, same path, same body — and it
will be accepted until the 30-second window closes. For a non-idempotent endpoint that means
the action happens twice.

The window is the only bound. Defending against identical replay needs a nonce carried in
the signed message plus server-side storage of spent nonces for at least the tolerance
period, which v1 does not have. Until then, TLS is what stands between an observer and a
replayable credential: **these endpoints must not be served over plaintext HTTP.**

### 9.3 A non-JSON body would go unsigned

The server captures the raw body through `express.json({ verify })`, and body-parser only
invokes that hook when the request's `Content-Type` is JSON. For any other content type the
raw body is never captured, `bodyHash` falls back to the hash of the empty string, and the
body travels **entirely outside the signature** — a `multipart/form-data` upload on a
protected route would be freely tamperable while the request still verifies.

Every protected endpoint is JSON-only today, so this is latent rather than live. It becomes a
live vulnerability the moment a protected route accepts another content type. **Any new
protected endpoint must be JSON**, or the raw-body capture in
`services/indexer/src/middleware/rawBody.ts` must be widened to cover its content type first.
