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

## Moderation

The moderation module provides stake-backed post reporting and moderator-reviewed verdicts.
There are no bans or per-user blocks in the moderation system — it operates at the post
level. Account-level blocking is handled separately via `block_user` / `unblock_user`.

### Overview

1. Any registered user files a `report_post` and locks tokens as collateral.
2. A `Moderator`-role account, co-signed by the `mods` pool threshold, calls `review_report`.
3. If the verdict is **Upheld**: the reported post is deleted, the author's creator tokens
   may be slashed (if `MODERATION_SLASH_BPS > 0`), and the reporter's stake is returned.
4. If the verdict is **Dismissed**: the reporter's stake is sent to the treasury.

### Report reason codes

Reports carry a `reason_hash: BytesN<32>` — the SHA-256 of the off-chain reason string.
The hash is stored on-chain; the raw reason text is stored off-chain (e.g. in the indexer).
This keeps on-chain storage minimal while giving indexers a tamper-evident link to the
full reason.

Clients should compute:

```
reason_hash = sha256(reason_text_utf8)
```

The contract does not validate or interpret the hash contents.

### Report flow

```
Reporter                    Contract                       Moderator
   |                           |                               |
   |-- report_post() --------->|                               |
   |   (stake locked in        |                               |
   |    contract escrow)       |                               |
   |                           |                               |
   |                           |<-- review_report() -----------|
   |                           |    (Upheld or Dismissed)      |
   |                           |                               |
   |  IF UPHELD:               |                               |
   |<-- stake returned --------|                               |
   |                        post deleted                       |
   |                     author slashed (if slash_bps > 0)     |
   |                           |                               |
   |  IF DISMISSED:            |                               |
   |                     stake → treasury                      |
```

### Rate limits

| Guard                           | Limit                                            |
| ------------------------------- | ------------------------------------------------ |
| Open reports per reporter       | 10 (enforced by `OpenReports(reporter)` counter) |
| Reporter cannot report own post | validated in `validate_reporter_can_report`      |

### Admin-only function table

| Function                           | Required role | Auth requirements                                             | Description                                             |
| ---------------------------------- | ------------- | ------------------------------------------------------------- | ------------------------------------------------------- |
| `review_report`                    | `Moderator`   | Moderator address signs + M-of-N `mods` pool admin co-signers | Reviews a pending report and issues a verdict.          |
| `grant_role`                       | `Admin`       | Admin address signs                                           | Grants the `Moderator` role to an account.              |
| `revoke_role`                      | `Admin`       | Admin address signs                                           | Revokes the `Moderator` role from an account.           |
| `gov_execute` (ModerationSlashBps) | `Admin`       | Admin executes a passed governance proposal                   | Changes the slash percentage applied to upheld reports. |

### Public functions

| Function           | Signature                                               | Description                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `report_post`      | `(reporter, post_id, token, stake_amount, reason_hash)` | Files a report and locks `stake_amount` tokens in contract escrow. Panics if the post does not exist, reporter is the author, already reported, or the reporter has ≥ 10 open reports. |
| `get_report`       | `(post_id, reporter) → Option<Report>`                  | Returns the `Report` struct for a given `(post_id, reporter)` pair, or `None`.                                                                                                         |
| `get_report_count` | `(post_id) → u32`                                       | Returns the total number of reports filed against a post.                                                                                                                              |

### Data types

**`Report` struct**

| Field            | Type           | Description                                         |
| ---------------- | -------------- | --------------------------------------------------- |
| `post_id`        | `u64`          | ID of the reported post.                            |
| `reporter`       | `Address`      | Address that filed the report.                      |
| `stake_amount`   | `i128`         | Amount of tokens locked as collateral.              |
| `token`          | `Address`      | SEP-41 token contract used for the stake.           |
| `reason_hash`    | `BytesN<32>`   | SHA-256 of the off-chain reason string.             |
| `created_ledger` | `u32`          | Ledger sequence when the report was filed.          |
| `status`         | `ReportStatus` | Current state: `Pending`, `Upheld`, or `Dismissed`. |

**`ReportStatus` enum**

| Variant     | Meaning                                                                             |
| ----------- | ----------------------------------------------------------------------------------- |
| `Pending`   | Report filed; awaiting moderator review.                                            |
| `Upheld`    | Moderator ruled the post violated policy. Post deleted, stake returned to reporter. |
| `Dismissed` | Moderator ruled the report invalid. Stake sent to treasury.                         |

### How moderation affects other operations

- A post deleted via `review_report` (verdict = Upheld) is removed from persistent storage
  and the author's `AuthorPosts` index. Associated likes, reports, and tip-cooldown entries
  are lazily cleaned up via `batch_cleanup_post`.
- Slashing burns creator tokens from the post author's balance using `burn_from`. The
  contract must have been pre-approved via `token.approve()`. If the allowance is
  insufficient, slashing is skipped gracefully — the rest of the upheld flow (post deletion,
  stake refund) still completes.
- The `MODERATION_SLASH_BPS` parameter is governed via the `ModerationSlashBps` governance
  proposal type and defaults to `0` (no slashing) at initialization.

### Events emitted

| Event                          | Topics                | Fields         | Emitted when            |
| ------------------------------ | --------------------- | -------------- | ----------------------- |
| `PostReportedEvent`            | `post_id`, `reporter` | `stake_amount` | `report_post` succeeds. |
| `PostRemovedByModerationEvent` | `post_id`, `reporter` | —              | Verdict = Upheld.       |
| `ReportDismissedEvent`         | `post_id`, `reporter` | —              | Verdict = Dismissed.    |
