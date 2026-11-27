# Linkora — Persistent Data Inventory

This document inventories every class of data that persists in Linkora, the storage
layer it lives in, and its full lifecycle from creation to deletion. Its primary audience
is project maintainers adding new features or on-call engineers tracing data flow.

A key distinction this guide maintains throughout: **ledger-committed data** is data whose
authoritative record is a Soroban contract entry on the Stellar blockchain; everything else
is derived state that can be rebuilt from the ledger or is strictly client-side.

---

## Table of Contents

1. [Storage layers](#1-storage-layers)
2. [On-chain records (Stellar ledger)](#2-on-chain-records-stellar-ledger)
3. [PostgreSQL projections (indexer)](#3-postgresql-projections-indexer)
4. [PostgreSQL tables (DM relay)](#4-postgresql-tables-dm-relay)
5. [Mobile device cache (SQLite)](#5-mobile-device-cache-sqlite)
6. [Web client state](#6-web-client-state)
7. [Deletion and eviction summary](#7-deletion-and-eviction-summary)

---

## 1. Storage layers

| Layer | Technology | Service / App | Authoritative? |
|---|---|---|---|
| Stellar ledger | Soroban contract storage | `packages/contracts` | **Yes** — source of truth for all social and financial state |
| PostgreSQL (indexer) | PostgreSQL 15+ | `services/indexer` | No — projection of on-chain events |
| PostgreSQL (DM relay) | PostgreSQL 15+ | `services/dm-relay` | Partial — relay holds ciphertext; keys are on-chain |
| SQLite (mobile) | expo-sqlite | `apps/mobile` | No — local cache only |
| sessionStorage (web) | Browser sessionStorage | `apps/web` | No — per-tab ephemeral state |
| localStorage (web) | Browser localStorage | `apps/web` | No — persists across reloads, never sent to any server |

---

## 2. On-chain records (Stellar ledger)

These are the data classes whose authoritative record is committed to the Stellar
blockchain inside a Soroban contract entry. They cannot be unilaterally deleted or
altered by any off-chain service; only a contract invocation can mutate them.

### 2.1 Posts

| Field | Type | Notes |
|---|---|---|
| `id` | `u64` | Monotonically incrementing counter assigned by the contract |
| `author` | Stellar address | Public key of the posting account |
| `content` | `String` | UTF-8 post body (max 280 chars enforced client-side before submission) |
| `tip_total` | `i128` | Cumulative XLM tips received in stroops |
| `like_count` | `u64` | Total likes |
| `timestamp` | `u64` | Ledger timestamp at creation |

**Lifecycle.** Written on `create_post`. Soft-deleted on `delete_post` (a `deleted_at`
flag is set in the contract; the entry is not physically removed from the ledger). Contract
entries expire per Soroban's storage TTL rules; a post whose TTL lapses becomes
inaccessible but the ledger history remains in archived form.

**Ledger vs client.** All fields are written to the ledger. The indexer projection (§3.2)
adds a `deleted_at` timestamp column but does not store any additional field that is not
present on-chain.

---

### 2.2 Profiles

| Field | Type | Notes |
|---|---|---|
| `address` | Stellar address | Contract storage key |
| `username` | `String` | Display name chosen by the user |
| `creator_token` | `String` | Optional creator-token identifier |

**Lifecycle.** Written or updated on `set_profile`. Profiles are persistent contract
entries; they do not expire unless the account's contract storage TTL lapses. There is no
delete operation.

**Ledger vs client.** All fields are written to the ledger.

---

### 2.3 Follow graph

| Field | Type | Notes |
|---|---|---|
| `follower` | Stellar address | Account initiating the follow |
| `followee` | Stellar address | Account being followed |

**Lifecycle.** Written on `follow`, removed on `unfollow`. The contract stores follow
relationships as a set entry keyed by `(follower, followee)`; there is no timestamp on the
ledger entry itself.

**Ledger vs client.** Both fields are written to the ledger. The `created_at` column in the
indexer projection (§3.3) is derived from the ledger sequence at ingestion time and is
**not** a ledger field.

---

### 2.4 Pools

| Field | Type | Notes |
|---|---|---|
| `pool_id` | Stellar address (C…) | Contract-generated pool ID |
| `token` | Stellar address | XLM or Soroban token contract |
| `balance` | `i128` | Current pool balance in stroops |
| `admins` | `Vec<Address>` | Ordered list of admin addresses |
| `threshold` | `u32` | Minimum admin approvals for a withdrawal |

**Lifecycle.** Created on `create_pool`. Balance updates on every deposit/withdrawal.
Admin list mutates on `add_admin` / `remove_admin`. Pools are persistent contract entries
with no expiry mechanism exposed through the public API.

**Ledger vs client.** All fields are written to the ledger.

---

### 2.5 Likes

| Field | Type | Notes |
|---|---|---|
| `post_id` | `u64` | References the target post |
| `user` | Stellar address | Account that liked the post |

**Lifecycle.** Written on `like_post`. The contract enforces one like per user per post.
Likes are not revocable through the public API.

**Ledger vs client.** Both fields are written to the ledger. The `tx_hash` and `created_at`
columns in the indexer projection are indexer-side metadata derived at ingestion time.

---

### 2.6 Tips

| Field | Type | Notes |
|---|---|---|
| `post_id` | `u64` | References the target post |
| `tipper` | Stellar address | Account sending the tip |
| `amount` | `i128` | Tip value in stroops |
| `fee` | `i128` | Protocol fee deducted at the time of the tip |

**Lifecycle.** Written on `tip_post`. Tips are immutable ledger entries; they cannot be
reversed after the transaction closes.

**Ledger vs client.** All fields are written to the ledger.

---

### 2.7 DM encryption keys

| Field | Type | Notes |
|---|---|---|
| `address` | Stellar address | Owning account |
| `x25519_pubkey` | `String` | Hex-encoded X25519 public key for ECDH |

**Lifecycle.** Published on `publish_dm_key`. Updating the key overwrites the previous
entry. There is no deletion; a user can rotate their key by publishing a new one.

**Ledger vs client.** Both fields are written to the ledger.

---

### 2.8 Governance proposals and votes

| Data class | Key fields (ledger) |
|---|---|
| Proposal | `proposal_id`, `proposer`, `parameter`, `new_value`, `status` |
| Vote | `(proposal_id, voter)`, `support` |

**Lifecycle.** Proposals progress through `Active → Passed/Failed → Executed/Vetoed`.
Votes are cast once per address per proposal and cannot be retracted.

**Ledger vs client.** All fields are written to the ledger.

---

## 3. PostgreSQL projections (indexer)

The indexer service (`services/indexer`) subscribes to Soroban contract events and writes
projections into PostgreSQL. These tables are **derived state**: they can be rebuilt by
replaying events from `START_LEDGER`. No table in this section is authoritative.

### 3.1 `raw_events`

Partitioned staging table that records every contract event exactly once before it is
projected into domain tables. The natural key `(ledger_sequence, event_index)` enforces
exactly-once ingestion.

| Column | Type | Notes |
|---|---|---|
| `ledger_sequence` | `BIGINT` | Part of composite PK; also the partition key |
| `event_index` | `INT` | Position within the ledger |
| `contract_id` | `TEXT` | Emitting contract address |
| `topic` | `TEXT[]` | Event topic array |
| `data` | `JSONB` | Event payload |
| `processed_at` | `TIMESTAMPTZ` | Set after domain projection completes; `NULL` while pending |

**Lifecycle.** Rows are retained indefinitely in partitioned buckets (1 M-ledger slices).
Old partitions can be dropped wholesale without a row-level DELETE; see the retention
manager (`services/indexer/src/retention.ts`).

---

### 3.2 `posts`

| Column | Type | Ledger field? |
|---|---|---|
| `id` | `BIGINT PK` | ✅ |
| `author` | `TEXT` | ✅ |
| `content` | `TEXT` | ✅ |
| `tip_total` | `BIGINT` | ✅ (denormalised from tips) |
| `like_count` | `BIGINT` | ✅ (denormalised from likes) |
| `created_at` | `TIMESTAMP` | ✅ (from ledger timestamp) |
| `deleted_at` | `TIMESTAMP` | ❌ indexer-only soft-delete flag |

**Lifecycle.** Inserted on `PostCreatedEvent`. `deleted_at` is set on `PostDeletedEvent`.
Rows are never physically deleted; queries filter `WHERE deleted_at IS NULL`.

---

### 3.3 `profiles`

| Column | Type | Ledger field? |
|---|---|---|
| `address` | `TEXT PK` | ✅ |
| `username` | `TEXT` | ✅ |
| `creator_token` | `TEXT` | ✅ |
| `updated_ledger` | `INTEGER` | ❌ indexer-only watermark |

**Lifecycle.** Upserted on `ProfileSetEvent`. Never deleted.

---

### 3.4 `follows` / `follow_counts`

`follows` stores the directed edge; `follow_counts` is a denormalised counter table kept in
sync by a PostgreSQL trigger (`sync_follow_counts`).

| Column | Ledger field? |
|---|---|
| `follower`, `followee` (PK) | ✅ |
| `created_at` | ❌ indexer timestamp |
| `followers_count`, `following_count` (`follow_counts`) | ❌ derived |

**Lifecycle.** Row inserted on `FollowEvent`, deleted on `UnfollowEvent`.

---

### 3.5 `tips` / `likes`

Both tables record individual events for idempotency and analytics.

| Column | Ledger field? |
|---|---|
| `post_id`, `tipper`/`user_address` | ✅ |
| `amount`, `fee` (tips) | ✅ |
| `tx_hash` | ❌ indexer-extracted from transaction metadata |
| `created_at` | ❌ indexer timestamp |

**Lifecycle.** Inserted once per event; never deleted.

---

### 3.6 `pools`

| Column | Ledger field? |
|---|---|
| `pool_id`, `token`, `balance`, `admins`, `threshold` | ✅ |
| `created_ledger`, `updated_ledger` | ❌ indexer watermarks |

**Lifecycle.** Upserted on pool events. Never deleted.

---

### 3.7 `blocks` / `dm_keys`

Both are direct projections of on-chain state.

| Table | Ledger fields | Indexer-only fields |
|---|---|---|
| `blocks` | `blocker`, `blocked` | — |
| `dm_keys` | `address`, `x25519_pubkey` | `updated_at` |

**Lifecycle.** `blocks` row deleted on `UnblockEvent`. `dm_keys` upserted on
`DmKeyPublishedEvent`; no deletion.

---

### 3.8 `governance_proposals` / `governance_votes`

Direct projections of governance events. All substantive fields are ledger-sourced.
`updated_ledger` on proposals is an indexer watermark.

**Lifecycle.** Proposals upserted on status transitions; votes inserted once per
`(proposal_id, voter)` pair. Neither is ever deleted.

---

### 3.9 `sent_notifications`

Idempotency guard that prevents duplicate push notifications for the same contract event.

| Column | Ledger field? |
|---|---|
| `event_id` | ❌ foreign key to `raw_events.id` |
| `event_type`, `recipient` | ❌ indexer-derived |
| `dispatch_key` | ❌ composite dedup key (UNIQUE) |
| `dispatched_at` | ❌ |

**Lifecycle.** One row per dispatched notification. Rows are never deleted; `dispatch_key`
uniqueness prevents re-dispatch even if the row outlives the original event.

---

### 3.10 `notification_preferences` / `device_tokens`

Purely server-side user preferences and push-token registrations. No ledger equivalent.

| Table | Purpose | Deleted when |
|---|---|---|
| `notification_preferences` | Per-address toggle flags | Never (overwritten on update) |
| `device_tokens` | FCM/APNs/web push tokens | On explicit deregister call or token rotation |

---

### 3.11 `reports`

Moderation reports submitted through the web or mobile client.

| Column | Ledger field? | Notes |
|---|---|---|
| `post_id` | ✅ (references ledger post) | |
| `reporter_address` | ✅ | |
| `reason`, `status`, `moderator_*` | ❌ | Indexer-only moderation workflow |

**Lifecycle.** Inserted on report submission. `status` progresses through
`pending → dismissed / action_taken`. Rows are retained for audit.

---

## 4. PostgreSQL tables (DM relay)

The DM relay (`services/dm-relay`) stores encrypted message payloads. It **does not** hold
plaintext content or private keys; those never leave the client.

### 4.1 `dm_messages`

| Column | Ledger field? | Notes |
|---|---|---|
| `id` | ❌ | UUID PK generated by the relay |
| `conversation_id` | ❌ | Deterministic hash of `(sender, recipient)` |
| `sender`, `recipient` | ✅ | Stellar addresses (also committed to ledger as DM key holders) |
| `ciphertext_b64` | ❌ | Base64 X25519-box ciphertext; plaintext never stored |
| `message_index` | ❌ | Sender-scoped sequence number for ordering |
| `timestamp` | ❌ | Client-supplied Unix ms timestamp |

**Lifecycle.** Written on message send. No automatic expiry; relay operators may purge
old rows by `created_at`. Idempotency is enforced by `(sender, recipient, message_index)`.

---

### 4.2 `message_idempotency`

| Column | Notes |
|---|---|
| `idempotency_key` | UUID supplied by the client |
| `sender_address` | Scopes the key to prevent cross-sender collisions |
| `request_fingerprint` | SHA-256 of the original request body |
| `response_status`, `response_body` | Cached relay response replayed on retry |

**Lifecycle.** Rows are written once per new `(sender_address, idempotency_key)` pair.
Old rows can be pruned by `created_at`; the relay currently retains them indefinitely.

---

## 5. Mobile device cache (SQLite)

The mobile app (`apps/mobile`) maintains a local SQLite database (`linkora_cache.db`) via
`expo-sqlite`. All tables here are **client-only**: they contain no data that is not also
available from the indexer or relay, and they are never synced back to any server.

### 5.1 `cached_posts`

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PK` | Matches the on-chain post ID; uses a local `pending_*` prefix while unconfirmed |
| `author`, `username`, `content` | `TEXT` | Copied from indexer response |
| `tip_total`, `like_count` | `INTEGER` | Snapshot at cache time |
| `has_liked` | `INTEGER (0/1)` | Per-device like state |
| `sync_status` | `TEXT` | `synced` / `pending` / `failed` |
| `timestamp` | `INTEGER` | Unix seconds from ledger |

**Lifecycle.** Rows inserted on feed fetch or optimistic post creation. `sync_status`
transitions to `synced` once the transaction is confirmed. Stale rows (older than 7 days or
beyond the 100-row cap) are evicted on app foreground by `evictStaleCache`.

---

### 5.2 `dm_messages`

Local mirror of decrypted DM content. Plaintext content is derived from the relay
ciphertext and stored here for display. This is the only place plaintext ever persists.

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PK` | Relay-assigned UUID |
| `conversation_id` | `TEXT` | Matches relay `conversation_id` |
| `sender`, `recipient` | `TEXT` | Stellar addresses |
| `content` | `TEXT` | **Decrypted plaintext** — client-only |
| `ciphertext_hash` | `TEXT` | SHA-256 for dedup |
| `sync_status` | `TEXT` | `synced` / `pending` / `failed` |

**Lifecycle.** Rows inserted on message fetch or optimistic send. No automatic eviction;
rows persist until the app is uninstalled or the user clears app data.

---

### 5.3 `dm_sync_state`

Tracks the per-conversation sync cursor to support incremental fetches.

| Column | Type | Notes |
|---|---|---|
| `conversation_id` | `TEXT PK` | |
| `sync_cursor` | `INTEGER` | Highest `message_index` synced from relay |
| `last_read` | `INTEGER` | Highest `message_index` read by the local user |

**Lifecycle.** Upserted on every sync. Persists until app uninstall.

---

## 6. Web client state

### 6.1 `sessionStorage` — rate-limit counters

Key pattern: `linkora:rl:<action_key>`

| Field | Type | Notes |
|---|---|---|
| Timestamps array | `number[]` (ms) | Each entry is the Unix-ms time of one recorded action |

**Lifecycle.** Written by `lib/rateLimit.ts`. Stale entries (outside the sliding window)
are pruned on every read or write. Cleared automatically when the browser tab closes.
**Client-only** — never sent to any server.

---

### 6.2 `localStorage` — blocked accounts list

Key: `linkora_blocked_accounts`

| Field | Notes |
|---|---|
| `string[]` of Stellar addresses | The local user's block list |

**Lifecycle.** Written by `lib/blockedStore.ts`. Survives page refresh; cleared on explicit
unblock or browser storage clear. **Client-only** — the authoritative block record is on
the ledger (§2, `blocks` contract storage); this cache avoids re-fetching on every render.

---

## 7. Deletion and eviction summary

| Data class | Storage layer | Can be deleted? | Mechanism |
|---|---|---|---|
| Posts | Ledger | Soft-delete only | `delete_post` sets a flag; entry never removed from ledger |
| Profiles | Ledger | No | — |
| Follow edges | Ledger | Yes | `unfollow` removes the contract entry |
| Likes | Ledger | No | — |
| Tips | Ledger | No | — |
| DM keys | Ledger | Rotation only | New `publish_dm_key` overwrites previous entry |
| Governance | Ledger | No | — |
| Posts (indexer) | PostgreSQL | Soft-delete | `deleted_at` timestamp; physical row retained |
| Follows (indexer) | PostgreSQL | Yes (hard) | Deleted on `UnfollowEvent` |
| Tips / Likes (indexer) | PostgreSQL | No | Retained for analytics |
| raw_events | PostgreSQL | Partition drop | Old ledger-range partitions dropped by retention manager |
| sent_notifications | PostgreSQL | No | Retained for idempotency |
| device_tokens | PostgreSQL | Yes | Explicit deregister API call |
| DM messages (relay) | PostgreSQL | Operator purge only | No automatic TTL; purge by `created_at` |
| message_idempotency | PostgreSQL | Operator purge only | No automatic TTL |
| cached_posts (mobile) | SQLite | Auto-eviction | `evictStaleCache`: 7-day TTL + 100-row cap |
| dm_messages (mobile) | SQLite | On uninstall | No automatic eviction |
| Rate-limit counters | sessionStorage | Tab close / window expiry | Entries pruned when outside sliding window |
| Blocked accounts | localStorage | Explicit unblock | `lib/blockedStore.ts` |

---

## Implementation and verification conventions

This document follows the same update discipline as `docs/deployment.md`:

- **New table** — add a row to §3, §4, or §5 and update the deletion summary in §7 when a
  migration is merged.
- **New contract storage field** — add it to the relevant §2 subsection and mark
  `Ledger field? ✅` in any indexer projection that mirrors it.
- **Verification** — run the indexer migrations against a fresh PostgreSQL instance
  (`docker compose up db && pnpm --filter indexer migrate`) and confirm every table in §3
  is present before merging schema changes.
