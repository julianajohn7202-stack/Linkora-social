# Linkora API Reference

> **Scope note.** This document covers **HTTP request authentication** for the indexer's REST
> API and the **Reputation / Post Scoring module**. The Soroban contract function reference,
> complete storage layout, and event schema are not here yet — see `packages/contracts` and
> the README API table in the meantime.

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
10. [Reputation Module (Post Scoring)](#10-reputation-module-post-scoring)
    - [10.1 Overview and Implementation Status](#101-overview-and-implementation-status)
    - [10.2 Storage](#102-storage)
    - [10.3 Scoring Signals and Formula](#103-scoring-signals-and-formula)
    - [10.4 Recency Decay](#104-recency-decay)
    - [10.5 Tier Thresholds](#105-tier-thresholds)
    - [10.6 Reading Scores via the Indexer API](#106-reading-scores-via-the-indexer-api)
    - [10.7 Score Refresh Lifecycle](#107-score-refresh-lifecycle)
    - [10.8 Planned: on-chain Reputation and SDK Integration](#108-planned-on-chain-reputation-and-sdk-integration)

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

---

## 10. Reputation Module (Post Scoring)

### 10.1 Overview and Implementation Status

The Reputation Module governs how posts are ranked for discovery. In the current implementation
the entire scoring pipeline is **off-chain**, running inside the indexer service
(`services/indexer`). There is no on-chain reputation contract yet.

Two files referenced in the project issue tracker are **planned but not yet created**:

| Planned file                        | Purpose                                             |
| ----------------------------------- | --------------------------------------------------- |
| `src/reputation.rs`                 | On-chain Soroban contract for per-user reputation   |
| `packages/reputation/src/scorer.ts` | TypeScript scorer to be consumed by SDK and clients |

Until those files are shipped, all scoring logic lives in the places listed below. This
section documents that live system.

| File                                              | Role                                       |
| ------------------------------------------------- | ------------------------------------------ |
| `services/indexer/migrations/009_post_scores.sql` | DDL — defines the `post_scores` view       |
| `services/indexer/src/score-refresh.ts`           | `ScoreRefreshService` — refresh scheduling |
| `services/indexer/src/api/routes/feed.ts`         | `GET /feed/explore` — score-ranked feed    |
| `services/indexer/src/metrics.ts`                 | `score_refresh_deferred_total` counter     |

---

### 10.2 Storage

Scores are not stored per row in the `posts` table. Instead they are materialised into a
separate read model that is recomputed from the `posts` source table on a schedule.

```sql
-- services/indexer/migrations/009_post_scores.sql
CREATE MATERIALIZED VIEW IF NOT EXISTS post_scores AS
SELECT
    p.id,
    p.author,
    p.content,
    p.tip_total,
    p.like_count,
    p.created_at,
    (
        100 +
        (p.like_count * 5) +
        (p.tip_total::numeric / 1000000) -
        EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600
    )::integer AS score,
    NOW() AS last_updated
FROM posts p
WHERE p.deleted_at IS NULL;
```

Three indexes are maintained on the view:

| Index                    | Columns                   | Purpose                                               |
| ------------------------ | ------------------------- | ----------------------------------------------------- |
| `idx_post_scores_score`  | `score DESC`              | Primary ordering for the explore feed                 |
| `idx_post_scores_author` | `author, created_at DESC` | Per-author lookups in the following feed              |
| `idx_post_scores_id`     | `id` (unique)             | Required for `REFRESH MATERIALIZED VIEW CONCURRENTLY` |

The view is refreshed via `REFRESH MATERIALIZED VIEW CONCURRENTLY post_scores`. Because that
statement requires exclusive access for the brief final swap, only one refresh can run at a
time. The scheduler handles collisions with retries — see [§10.7](#107-score-refresh-lifecycle).

---

### 10.3 Scoring Signals and Formula

The score for a post is a single integer computed at refresh time. Four signals feed into it:

| Signal     | Weight                               | Source column |
| ---------- | ------------------------------------ | ------------- |
| Base score | +100 (constant for every live post)  | —             |
| Likes      | +5 per like                          | `like_count`  |
| Tips       | +1 per 1 000 000 stroops (≈ 0.1 XLM) | `tip_total`   |
| Recency    | −1 per hour since `created_at`       | `created_at`  |

The formula in full:

```
score = 100
      + (like_count × 5)
      + (tip_total / 1_000_000)
      − floor(age_in_seconds / 3600)
```

`tip_total` is stored in **stroops** (the smallest Stellar unit, 1 XLM = 10 000 000 stroops).
Dividing by 1 000 000 normalises it so that roughly 0.1 XLM of tips equals 1 score point.

Example — a post with 10 likes and 1 XLM tip (10 000 000 stroops), created 2 hours ago:

```
100 + (10 × 5) + (10_000_000 / 1_000_000) − 2
= 100 + 50 + 10 − 2
= 158
```

Because the score is cast to `integer` the result is truncated (not rounded) toward zero.

---

### 10.4 Recency Decay

The decay term is linear, not exponential:

```
decay = floor(age_in_seconds / 3600)   -- 1 point per hour
```

A brand-new post starts with a base of 100 and loses exactly 1 point for every hour it ages,
regardless of engagement. This means a post with zero engagement reaches a score of 0 after
100 hours (≈ 4.2 days) and goes negative thereafter.

Posts are never removed from `post_scores` due to a low score alone. They remain in the view
until their corresponding row in `posts` is soft-deleted (`deleted_at IS NOT NULL`), at
which point the view excludes them on the next refresh.

> **Planned:** The future `packages/reputation/src/scorer.ts` is expected to expose
> configurable decay parameters (half-life, floor, per-signal weights). Until then the
> weights above are hard-coded in the migration SQL and can only be changed by a new
> migration.

---

### 10.5 Tier Thresholds

There are no tier thresholds defined in the current codebase. The score is a continuous
integer used only for ordering — no "Bronze / Silver / Gold" classification exists in the
database schema, the indexer API, or the contracts.

Tier labels are expected to be introduced in either:

- `packages/reputation/src/scorer.ts` (off-chain classification), or
- `src/reputation.rs` (on-chain reputation tiers backed by Soroban storage).

Neither file exists yet. If you are building a client that wants to display tiers today,
you must define the thresholds locally. The following illustrative ranges are **not**
enforced by the system:

| Tier     | Score range (illustrative) |
| -------- | -------------------------- |
| Rising   | 0 – 99                     |
| Active   | 100 – 249                  |
| Popular  | 250 – 499                  |
| Trending | 500 +                      |

These numbers are provided as a starting point only and are subject to change once the
official tier spec is shipped.

---

### 10.6 Reading Scores via the Indexer API

There are no SDK methods for reading scores — the SDK only wraps Soroban contract calls and
does not talk to the indexer REST API directly. Scores are exposed through a single indexer
endpoint.

#### `GET /feed/explore`

Returns posts ranked by descending score. Supports cursor-based pagination and optional tag
filtering.

| Parameter | Type   | Required | Description                                                               |
| --------- | ------ | -------- | ------------------------------------------------------------------------- |
| `limit`   | number | no       | Number of posts to return (default 20, max 100)                           |
| `cursor`  | number | no       | Exclusive upper bound on `score`; omit on first page                      |
| `tag`     | string | no       | Filter to posts whose `tags` array contains this value (case-insensitive) |

Example — first page of explore feed:

```
GET /api/feed/explore?limit=10
```

```json
{
  "posts": [
    {
      "id": 42,
      "author": "GABC...XYZ",
      "content": "Hello Linkora!",
      "tags": ["intro"],
      "tip_total": 10000000,
      "like_count": 12,
      "created_at": "2026-09-29T10:00:00.000Z",
      "score": 162
    }
  ],
  "has_more": false,
  "next_cursor": 162
}
```

Example — next page using the `next_cursor` from the previous response:

```
GET /api/feed/explore?limit=10&cursor=162
```

The server queries `post_scores WHERE score < :cursor ORDER BY score DESC LIMIT :limit`.
Pass `next_cursor` from the previous response as `cursor` on the next request. When
`has_more` is `false`, you have reached the end of the feed.

Example — fetch explore feed directly with `fetch`:

```typescript
async function fetchExploreFeed(
  baseUrl: string,
  limit = 20,
  cursor?: number,
  tag?: string
): Promise<{ posts: Post[]; hasMore: boolean; nextCursor: number | null }> {
  const url = new URL("/api/feed/explore", baseUrl);
  url.searchParams.set("limit", String(limit));
  if (cursor !== undefined) url.searchParams.set("cursor", String(cursor));
  if (tag) url.searchParams.set("tag", tag);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Explore feed request failed: ${res.status}`);

  const data = await res.json();
  return {
    posts: data.posts,
    hasMore: data.has_more,
    nextCursor: data.next_cursor,
  };
}
```

Reading a specific post's score is not a dedicated endpoint. To read the score for a known
post ID, query the explore feed and look up by `id`, or query the `post_scores` view directly
if you have database access:

```sql
SELECT id, score, last_updated
FROM post_scores
WHERE id = $1;
```

---

### 10.7 Score Refresh Lifecycle

`ScoreRefreshService` (`services/indexer/src/score-refresh.ts`) owns the refresh schedule.

**Defaults:**

| Parameter                | Default  | Description                                       |
| ------------------------ | -------- | ------------------------------------------------- |
| `refreshIntervalMinutes` | `5`      | Cron cadence — `*/5 * * * *`                      |
| `statementTimeoutMs`     | `30 000` | Per-attempt `SET LOCAL statement_timeout`         |
| `maxRetries`             | `5`      | Maximum consecutive retries after first collision |
| `retryBaseDelayMs`       | `1 000`  | Base delay for exponential backoff                |
| `retryMaxDelayMs`        | `30 000` | Upper cap on backoff delay                        |
| `jitterFraction`         | `0.25`   | Fraction of interval used for startup jitter      |

**Refresh flow:**

1. A cron job fires every `refreshIntervalMinutes` minutes plus a random jitter of up to
   `jitterFraction × interval`. The jitter desynchronises multiple indexer replicas so they
   do not all fire at the same clock boundary.
2. The service opens a dedicated connection, issues `BEGIN`, sets
   `SET LOCAL statement_timeout`, and runs
   `REFRESH MATERIALIZED VIEW CONCURRENTLY post_scores`.
3. On success it commits and logs `[score-refresh] Successfully refreshed post_scores`.
4. On a transient collision (concurrent refresh in progress, lock timeout `55P03`,
   statement timeout `57014`, deadlock `40P01`, serialization failure `40001`) it rolls
   back, emits the `score_refresh_deferred_total` Prometheus counter, logs a structured
   JSON event, and retries with **exponential backoff + full jitter**:

```
delay = random(floor(cap / 2), cap)   where  cap = min(base × 2^attempt, maxDelay)
```

5. After `maxRetries` consecutive transient failures, or on any non-transient error, the
   exception is re-thrown. The scheduler catches it and keeps itself alive for the next
   scheduled run.

The `score_refresh_deferred_total` counter is exposed in the Prometheus text format via the
metrics endpoint and is the primary signal for refresh contention in production.

---

### 10.8 Planned: on-chain Reputation and SDK Integration

The items below are tracked in the issue backlog and are listed here so integrators know
what is coming.

**`src/reputation.rs`** — a Soroban contract module that will add:

- Per-user reputation scores stored in Soroban persistent storage.
- On-chain storage keys for reputation data (e.g. `Reputation(Address) -> u64`).
- Tier classification enforced at the contract level.
- Events emitted on reputation changes (`ReputationUpdated`, `TierChanged`).

**`packages/reputation/src/scorer.ts`** — a TypeScript scorer that will:

- Expose a typed `getScore(postId: number): Promise<number>` helper wrapping the indexer API.
- Provide `classifyTier(score: number): Tier` with the official thresholds.
- Be consumable by both `apps/web` and `apps/mobile` without duplicating fetch logic.

Until these files land, use the `GET /api/feed/explore` endpoint directly (see [§10.6](#106-reading-scores-via-the-indexer-api)) and define any tier logic locally.
