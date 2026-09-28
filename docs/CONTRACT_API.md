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
10. [Storage Layout](#10-storage-layout)

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

## 10. Storage Layout

The Linkora Soroban contract (`packages/contracts/contracts/linkora-contracts/src/lib.rs`) organizes on-chain state across Soroban's three storage durability namespaces:

- **`persistent`**: Long-lived application records (profiles, posts, adjacency-set social graph, governance proposals, moderation reports, and credential roots). Automatically extended via `LEDGER_BUMP` (`535,000` ledgers, ~30 days at 5s/ledger) when remaining TTL falls below `LEDGER_THRESHOLD` (`534,900` ledgers).
- **`instance`**: Contract-wide configuration scalars, counters, role maps, and staged WASM upgrade proposals tied to the contract instance TTL.
- **`temporary`**: Short-lived rate-limiting and anti-spam cooldown entries (`TipCooldown`, `PoolDepositCooldown`) that expire automatically without requiring rent cleanup.

### 10.1 Typed `StorageKey` Enum (`#[contracttype]`)

| Key Name | Type | Namespace | Description |
| :--- | :--- | :--- | :--- |
| `Post(u64)` | `Post` | `persistent` | Maps `post_id` to its `Post` record (`id`, `author`, `content`, `tip_total`, `timestamp`, `like_count`). |
| `Profile(Address)` | `Profile` | `persistent` | Maps user `Address` to their `Profile` (`address`, `username`, `creator_token`). |
| `Following(Address)` | `Vec<Address>` | `persistent` | Legacy following list for `user` (retained for migration to ADR-001 adjacency-set keys). |
| `Followers(Address)` | `Vec<Address>` | `persistent` | Legacy followers list for `user` (retained for migration to ADR-001 adjacency-set keys). |
| `Pool(Symbol)` | `Pool` | `persistent` | Maps `pool_id` to community `Pool` state (`token`, `balance`, `admins`, `threshold`). |
| `Like(u64, Address)` | `bool` | `persistent` | Tracks whether `(post_id, user)` has liked a given post. |
| `AuthorPosts(Address)` | `Vec<u64>` | `persistent` | Ordered list of post IDs authored by `Address`. |
| `Blocks(Address)` | `Map<Address, ()>` | `persistent` | Map of addresses blocked by `blocker`. |
| `BlockedBy(Address)` | `Map<Address, ()>` | `persistent` | Reverse index of addresses that have blocked `blocked`. |
| `UsernameIndex(String)` | `Address` | `persistent` | Reverse index mapping normalized `username` to owner `Address` to enforce uniqueness. |
| `TipCooldown(u64, Address)` | `u32` | `temporary` | Records the last ledger sequence number when `tipper` tipped `post_id` (default window: `17,280` ledgers). |
| `PoolDepositCooldown(Symbol, Address)` | `u32` | `temporary` | Records the last ledger sequence number when `depositor` deposited into `pool_id` (default window: `720` ledgers). |
| `Edge(Address, Address)` | `bool` | `persistent` | ADR-001 directed social graph edge `(follower, followee) -> bool`. |
| `FollowingCount(Address)` | `u32` | `persistent` | Total number of accounts `user` is currently following. |
| `FollowersCount(Address)` | `u32` | `persistent` | Total number of followers for `user`. |
| `FollowingIdx(Address, u32)` | `Address` | `persistent` | Zero-based ordered index `(user, seq) -> followee Address` for O(1) swap-remove pagination. |
| `FollowersIdx(Address, u32)` | `Address` | `persistent` | Zero-based ordered index `(user, seq) -> follower Address` for O(1) swap-remove pagination. |
| `FollowingPos(Address, Address)` | `u32` | `persistent` | Position lookup `(follower, followee) -> seq` inside `FollowingIdx`. |
| `FollowersPos(Address, Address)` | `u32` | `persistent` | Position lookup `(followee, follower) -> seq` inside `FollowersIdx`. |
| `GraphMigrated(Address)` | `bool` | `persistent` | Indicates whether `user`'s legacy `Following`/`Followers` vectors have been migrated to ADR-001 keys. |
| `DmPublicKey(Address)` | `BytesN<32>` | `persistent` | User's X25519 public key for end-to-end encrypted direct messages. |
| `CredentialRoot(Address)` | `BytesN<32>` | `persistent` | User's verified credential Merkle root. |
| `NullifierSet(Address, BytesN<32>)` | `bool` | `persistent` | Consumed credential proof nullifier `(user, nullifier)` preventing replay attacks. |
| `CredentialAuthority` | `BytesN<32>` | `persistent` | Trusted Ed25519 public key authorized to sign credential root updates. |
| `GovProposal(u64)` | `GovProposal` | `persistent` | Governance proposal record indexed by `proposal_id`. |
| `GovVote(u64, Address)` | `bool` | `persistent` | Tracks whether `voter` has already voted on `proposal_id`. |
| `GovConfig` | `GovConfig` | `persistent` | Active on-chain governance configuration parameters. |
| `GovProposalCount` | `u64` | `persistent` | Auto-incrementing counter for the next governance proposal ID. |
| `GovOpenProposalCount(Address)` | `u32` | `persistent` | Number of currently open proposals created by `proposer` (bounded by `MAX_OPEN_PROPOSALS_PER_PROPOSER = 5`). |
| `OracleKey(Symbol)` | `BytesN<32>` | `persistent` | Maps `oracle_name` symbol to its trusted Ed25519 public key. |
| `AttestationNullifier(BytesN<32>)` | `bool` | `persistent` | Replay guard mapping `sha256(report_cbor)` to `true` once processed. |
| `Report(u64, Address)` | `Report` | `persistent` | Moderation report submitted by `reporter` against `post_id`. |
| `ReportCount(u64)` | `u32` | `persistent` | Total number of moderation reports filed against `post_id`. |
| `OpenReports(Address)` | `u32` | `persistent` | Count of unresolved reports filed by `reporter` (bounded by `MAX_OPEN_REPORTS_PER_REPORTER = 10`). |
| `DeletedPost(u64)` | `bool` | `persistent` | Tombstone flag marking `post_id` as deleted for lazy cleanup. |
| `DeletedProfile(Address)` | `bool` | `persistent` | Tombstone flag marking `user` profile as deleted for lazy cleanup. |
| `PostLikersCount(u64)` | `u32` | `persistent` | Total number of likers indexed for `post_id` cleanup tracking. |
| `PostLikersIdx(u64, u32)` | `Address` | `persistent` | Indexed liker address `(post_id, seq)` used during lazy post cleanup. |
| `PostReportersIdx(u64, u32)` | `Address` | `persistent` | Indexed reporter address `(post_id, seq)` used during lazy post cleanup. |
| `PostTipCooldownsCount(u64)` | `u32` | `persistent` | Count of active tip cooldown entries associated with `post_id`. |
| `PostTipCooldownsIdx(u64, u32)` | `Address` | `persistent` | Indexed tipper address `(post_id, seq)` for tip cooldown cleanup. |
| `UpgradeProposal` | `UpgradeProposal` | `instance` | Staged WASM upgrade proposal subject to `UPGRADE_TIMELOCK_LEDGERS` (`17,280` ledgers). |

### 10.2 Instance-Storage Scalar Keys (`symbol_short!`)

| Constant | Symbol Key | Type | Namespace | Description |
| :--- | :--- | :--- | :--- | :--- |
| `POST_CT` | `"POST_CT"` | `u64` | `instance` | Sequential counter for total created posts. |
| `PROFILE_CREATED_CT` | `"PROF_CT"` | `u64` | `instance` | Sequential counter for total registered profiles. |
| `ADMIN` | `"ADMIN"` | `Address` | `instance` | Primary contract administrator address. |
| `TREASURY` | `"TREASURY"` | `Address` | `instance` | Protocol treasury recipient address for fee splits. |
| `FEE_BPS` | `"FEE_BPS"` | `u32` | `instance` | Protocol fee in basis points (bounded by `MAX_FEE_BPS`). |
| `INITIALIZED` | `"INIT"` | `bool` | `instance` | One-time initialization guard flag. |
| `TIP_COOLDOWN_WINDOW` | `"TIP_CD_W"` | `u32` | `instance` | Configurable ledger cooldown window between tips on the same post. |
| `REGISTERED_USERS` | `"R_USERS"` | `Vec<Address>` | `instance` | Registry of initialized user addresses. |
| `RENT_RATE_BPS_KEY` | `"RENT_BPS"` | `u32` | `instance` | Storage rent rate in basis points. |
| `MODERATION_SLASH_BPS` | `"MOD_SL_B"` | `u32` | `instance` | Slash percentage in basis points applied on moderation verdicts. |
| `CONTRACT_STATE` | `"CT_STATE"` | `ContractState` | `instance` | Tracks schema `version` (`u32`) and `implementation_wasm_hash` (`Option<BytesN<32>>`). |
| `ROLES` | `"ROLES"` | `Map<Address, u32>` | `instance` | Role-based access control bitmask map. |
| `PAUSED` | `"PAUSED"` | `bool` | `instance` | Emergency circuit-breaker pause flag. |
| `MAX_POST_LEN_KEY` | `"MAX_POST"` | `u32` | `instance` | Configurable maximum post length override. |
| `MAX_BIO_LEN_KEY` | `"MAX_BIO"` | `u32` | `instance` | Configurable maximum profile bio length override. |

