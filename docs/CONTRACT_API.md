# Linkora API Reference

> **Scope note.** This document covers HTTP request authentication for the indexer's REST API
> and the Soroban contract storage layout. Additional contract function reference and event
> schema sections are forthcoming.

---

## Table of Contents

1. [Storage Layout](#1-storage-layout)
2. [Stellar HTTP Authentication (v1)](#2-stellar-http-authentication-v1)
3. [The Signed Message](#3-the-signed-message)
4. [Canonical Path](#4-canonical-path)
5. [Body Hash](#5-body-hash)
6. [The Authorization Header](#6-the-authorization-header)
7. [Verification Order and Error Codes](#7-verification-order-and-error-codes)
8. [Worked Example](#8-worked-example)
9. [Protected Endpoints](#9-protected-endpoints)
10. [Known Limitations of v1](#10-known-limitations-of-v1)

---

## 1. Storage Layout

The `LinkoraContract` uses Soroban's three storage tiers. All on-chain keys are defined as
variants of the `StorageKey` enum in
`packages/contracts/contracts/linkora-contracts/src/lib.rs`, plus a set of short `Symbol`
constants for instance storage scalars that cannot be expressed as enum variants without
exceeding the Soroban symbol length limit.

### TTL constants

| Constant           | Value   | Approximate duration (5 s/ledger) |
| ------------------ | ------- | --------------------------------- |
| `LEDGER_BUMP`      | 535,000 | ~30 days                          |
| `LEDGER_THRESHOLD` | 534,900 | ~30 days (minus 100 ledgers)      |

Persistent entries are extended on every successful read or write. Instance storage is
bumped on every mutating call. Temporary entries (`TipCooldown`, `PoolDepositCooldown`) use
the same TTL values.

---

### Persistent storage — `StorageKey` enum variants

| Key name                               | Type (value stored) | Description                                                                                     |
| -------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------- |
| `Post(u64)`                            | `Post`              | A post record keyed by auto-incrementing `post_id`.                                             |
| `Profile(Address)`                     | `Profile`           | A user profile keyed by the owner's Stellar address.                                            |
| `Following(Address)`                   | `Vec<Address>`      | **Legacy.** Vec-based following list kept for migration; superseded by the adjacency-set graph. |
| `Followers(Address)`                   | `Vec<Address>`      | **Legacy.** Vec-based followers list kept for migration; superseded by the adjacency-set graph. |
| `Pool(Symbol)`                         | `Pool`              | A community pool keyed by its short `Symbol` identifier.                                        |
| `Like(u64, Address)`                   | `bool`              | Records that `(post_id, user)` has been liked.                                                  |
| `AuthorPosts(Address)`                 | `Vec<u64>`          | Ordered list of post IDs authored by a user.                                                    |
| `Blocks(Address)`                      | `Map<Address, ()>`  | Forward block list: addresses blocked by the keyed user.                                        |
| `BlockedBy(Address)`                   | `Map<Address, ()>`  | Reverse block index: addresses that have blocked the keyed user.                                |
| `UsernameIndex(String)`                | `Address`           | Reverse index: maps a unique username string to its owner address.                              |
| `TipCooldown(u64, Address)`            | `u32`               | **Temporary.** Ledger sequence of the last tip from `(post_id, tipper)`.                        |
| `PoolDepositCooldown(Symbol, Address)` | `u32`               | **Temporary.** Ledger sequence of the last pool deposit from `(pool_id, depositor)`.            |
| `Edge(Address, Address)`               | `bool`              | Adjacency-set social graph (ADR-001): `(follower, followee)` → `true`.                          |
| `FollowingCount(Address)`              | `u32`               | Total number of accounts the keyed user is following.                                           |
| `FollowersCount(Address)`              | `u32`               | Total number of accounts following the keyed user.                                              |
| `FollowingIdx(Address, u32)`           | `Address`           | Ordered following index: `(user, seq)` → followee address.                                      |
| `FollowersIdx(Address, u32)`           | `Address`           | Ordered followers index: `(user, seq)` → follower address.                                      |
| `FollowingPos(Address, Address)`       | `u32`               | O(1) swap-remove helper: `(follower, followee)` → position in `FollowingIdx`.                   |
| `FollowersPos(Address, Address)`       | `u32`               | O(1) swap-remove helper: `(followee, follower)` → position in `FollowersIdx`.                   |
| `GraphMigrated(Address)`               | `bool`              | Migration tracking flag: `true` once a user's legacy graph has been migrated.                   |
| `DmPublicKey(Address)`                 | `BytesN<32>`        | User's X25519 public key for encrypted direct messages.                                         |
| `CredentialRoot(Address)`              | `BytesN<32>`        | Merkle root of the user's off-chain credential set.                                             |
| `NullifierSet(Address, BytesN<32>)`    | `bool`              | Replay guard: marks `(user, nullifier)` as consumed after a credential proof.                   |
| `CredentialAuthority`                  | `BytesN<32>`        | Ed25519 public key of the trusted authority that signs credential root updates.                 |
| `GovProposal(u64)`                     | `GovProposal`       | A governance proposal keyed by its ID.                                                          |
| `GovVote(u64, Address)`                | `bool`              | Prevents double-voting: `(proposal_id, voter)` → `true` once voted.                             |
| `GovConfig`                            | `GovConfig`         | Active governance configuration (quorum, time-lock, vote window, decay).                        |
| `GovProposalCount`                     | `u64`               | Monotonically increasing counter used to assign proposal IDs.                                   |
| `GovOpenProposalCount(Address)`        | `u32`               | Count of unresolved proposals per proposer (rate-limit guard).                                  |
| `OracleKey(Symbol)`                    | `BytesN<32>`        | Ed25519 public key of a registered analytics oracle, keyed by oracle name.                      |
| `AttestationNullifier(BytesN<32>)`     | `bool`              | Replay guard: `sha256(report_cbor)` → `true` once an attestation is accepted.                   |
| `Report(u64, Address)`                 | `Report`            | A moderation report for `(post_id, reporter)`.                                                  |
| `ReportCount(u64)`                     | `u32`               | Total number of reports filed against a post.                                                   |
| `OpenReports(Address)`                 | `u32`               | Count of unresolved reports filed by a reporter (rate-limit guard, max 10).                     |
| `DeletedPost(u64)`                     | `bool`              | Tombstone written by `delete_post`; signals `batch_cleanup_post` to reclaim storage.            |
| `DeletedProfile(Address)`              | `bool`              | Tombstone written by `delete_profile`; signals `batch_cleanup_profile` to reclaim storage.      |
| `PostLikersCount(u64)`                 | `u32`               | Total number of unique addresses that have liked a post.                                        |
| `PostLikersIdx(u64, u32)`              | `Address`           | Likers index: `(post_id, seq)` → liker address (used for O(1) cleanup).                         |
| `PostReportersIdx(u64, u32)`           | `Address`           | Reporters index: `(post_id, seq)` → reporter address. Count is `ReportCount`.                   |
| `PostTipCooldownsCount(u64)`           | `u32`               | Number of unique tippers with an active cooldown entry for a post.                              |
| `PostTipCooldownsIdx(u64, u32)`        | `Address`           | Tipper index: `(post_id, seq)` → tipper address (used for lazy cleanup).                        |

#### Instance storage — `StorageKey` enum variant

| Key name          | Type (value stored) | Description                                                |
| ----------------- | ------------------- | ---------------------------------------------------------- |
| `UpgradeProposal` | `UpgradeProposal`   | Staged WASM upgrade proposal written by `propose_upgrade`. |

---

### Instance storage — `Symbol` constants

These short-symbol keys are stored directly in instance storage (not as `StorageKey` enum
variants). They hold small scalar or map values that are accessed on nearly every call, so
instance storage is the appropriate tier.

| Symbol constant        | Symbol literal | Type                 | Description                                                                           |
| ---------------------- | -------------- | -------------------- | ------------------------------------------------------------------------------------- |
| `POST_CT`              | `"POST_CT"`    | `u64`                | Auto-incrementing post ID counter.                                                    |
| `PROFILE_CREATED_CT`   | `"PROF_CT"`    | `u64`                | Total number of profiles ever created (never decremented on delete).                  |
| `ADMIN`                | `"ADMIN"`      | `Address`            | **Deprecated legacy field.** Roles are now stored in `ROLES`.                         |
| `TREASURY`             | `"TREASURY"`   | `Address`            | Address that receives protocol fees.                                                  |
| `FEE_BPS`              | `"FEE_BPS"`    | `u32`                | Protocol fee in basis points (0–10,000).                                              |
| `INITIALIZED`          | `"INIT"`       | `bool`               | Set to `true` after `initialize`; prevents re-initialization.                         |
| `TIP_COOLDOWN_WINDOW`  | `"TIP_CD_W"`   | `u32`                | Per-tipper per-post cooldown in ledgers (default ~1 day).                             |
| `REGISTERED_USERS`     | `"R_USERS"`    | `Map<Address, bool>` | Registry of all addresses that have ever called `set_profile`.                        |
| `RENT_RATE_BPS_KEY`    | `"RENT_BPS"`   | `u32`                | Rent rate in basis points used by `pay_rent` (default 100).                           |
| `MODERATION_SLASH_BPS` | `"MOD_SL_B"`   | `u32`                | Slash percentage applied to author creator tokens on upheld reports (default 0).      |
| `CONTRACT_STATE`       | `"CT_STATE"`   | `ContractState`      | Contract schema version and last-deployed WASM hash.                                  |
| `ROLES`                | `"ROLES"`      | `Map<Address, u32>`  | Bitmask role map: Admin = bit 0, Moderator = bit 1, Pauser = bit 2, Upgrader = bit 3. |
| `PAUSED`               | `"PAUSED"`     | `bool`               | When `true`, all state-mutating functions will panic.                                 |
| `MAX_POST_LEN_KEY`     | `"MAX_POST"`   | `u32`                | Configurable maximum post content length in bytes.                                    |
| `MAX_BIO_LEN_KEY`      | `"MAX_BIO"`    | `u32`                | Configurable maximum bio length in bytes.                                             |

---

## 2. Stellar HTTP Authentication (v1)

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

## 3. The Signed Message

```
v1:{METHOD}:{canonicalPath}:{address}:{timestamp}:{bodyHash}
```

| Field           | Description                                                                |
| --------------- | -------------------------------------------------------------------------- |
| `v1`            | Literal version tag.                                                       |
| `METHOD`        | HTTP method, **upper-cased**: `GET`, `POST`, `PATCH`, `DELETE`.            |
| `canonicalPath` | Request path after canonicalisation — see [§4](#4-canonical-path).         |
| `address`       | Signer's Stellar public key (`G…`), exactly as sent in the header payload. |
| `timestamp`     | Unix epoch in **milliseconds**, as an integer with no separators.          |
| `bodyHash`      | Lowercase hex SHA-256 of the raw body — see [§5](#5-body-hash).            |

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

## 4. Canonical Path

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

## 5. Body Hash

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

## 6. The Authorization Header

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

## 7. Verification Order and Error Codes

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

## 8. Worked Example

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

## 9. Protected Endpoints

| Method | Path                             | Body |
| ------ | -------------------------------- | ---- |
| `POST` | `/api/notifications/register`    | JSON |
| `POST` | `/api/notifications/deregister`  | JSON |
| `GET`  | `/api/notifications/preferences` | none |
| `POST` | `/api/notifications/preferences` | JSON |
| `POST` | `/api/messages`                  | JSON |

All other indexer endpoints are public reads and take no `Authorization` header.

---

## 10. Known Limitations of v1

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
