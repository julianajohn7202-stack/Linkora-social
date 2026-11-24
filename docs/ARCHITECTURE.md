# System Architecture

This document describes the major components of the Linkora platform and how they interact.

---

## Table of Contents

1. [High-level overview](#1-high-level-overview)
2. [Component breakdown](#2-component-breakdown)
3. [DM encryption architecture](#3-dm-encryption-architecture)
4. [Database ownership](#4-database-ownership)

---

## 1. High-level overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Soroban Smart Contract  (packages/contracts)                   │
│  Profiles · Posts · Tips · Pools · Governance · Moderation      │
└───────────┬────────────────────────┬────────────────────────────┘
            │ contract calls (XDR)   │ events (Stellar RPC)
            ▼                        ▼
┌──────────────────────┐   ┌─────────────────────────────────────┐
│  SDK (packages/sdk)  │   │  Indexer (services/indexer)         │
│  LinkoraClient       │   │  PostgreSQL · full-text search API  │
│  TransactionQueue    │   └──────────────┬──────────────────────┘
└──────────┬───────────┘                  │ REST / WebSocket
           │                              ▼
           │              ┌────────────────────────────────────┐
           └─────────────►│  Web (apps/web)                    │
                          │  Mobile (apps/mobile)              │
                          │  Next.js 15 · Expo / React Native  │
                          └────────────────────────────────────┘
```

---

## 2. Component breakdown

| Component        | Path                        | Role                                                                              |
| ---------------- | --------------------------- | --------------------------------------------------------------------------------- |
| Smart contract   | `packages/contracts`        | On-chain state: profiles, posts, tips, pools, governance, moderation              |
| SDK              | `packages/sdk`              | Typed TypeScript client; wraps XDR encoding, transaction queuing, DM crypto       |
| Indexer          | `services/indexer`          | Listens for Stellar events, stores them in PostgreSQL, exposes REST/WS search API |
| DM relay         | `services/dm-relay`         | Routes ciphertext between users; never sees plaintext                             |
| Analytics oracle | `services/analytics-oracle` | Aggregates off-chain engagement signals and submits them on-chain                 |
| Web              | `apps/web`                  | Next.js 15 frontend                                                               |
| Mobile           | `apps/mobile`               | Expo / React Native app                                                           |
| Mini apps        | `examples/mini-apps`        | Third-party apps embedded in the shell via the Bridge API                         |

---

## 3. DM encryption architecture

Linkora's direct messages are end-to-end encrypted (E2EE). The relay service (`services/dm-relay`) routes opaque ciphertext and is architecturally prevented from reading message content. Encryption and decryption happen exclusively in the client (SDK).

### Cryptographic primitives

| Primitive                | Algorithm             | Library                 |
| ------------------------ | --------------------- | ----------------------- |
| Key agreement            | X25519 Diffie-Hellman | `@noble/curves/ed25519` |
| Key derivation           | HKDF-SHA256           | `@noble/hashes/hkdf`    |
| Authenticated encryption | ChaCha20-Poly1305     | `@noble/ciphers/chacha` |

Implemented in [`packages/sdk/src/dm/crypto.ts`](../packages/sdk/src/dm/crypto.ts).

### End-to-end message flow

```
Sender                        Relay (dm-relay)              Recipient
  │                                  │                           │
  │  1. generateDmKeypair()          │                           │
  │     → X25519 key pair            │                           │
  │                                  │                           │
  │  2. publishDmKey(pubKey)         │                           │
  │     → on-chain via contract ─────────────────────────────────│──► stored in contract
  │                                  │                           │
  │  3. getDmKey(recipientAddr)      │                           │    (recipient did the same)
  │     ← recipient's pubKey ◄───────────────────────────────────│
  │                                  │                           │
  │  4. deriveSharedSecret(          │                           │
  │       myPrivKey, theirPubKey)    │                           │
  │     → X25519 shared secret       │                           │
  │                                  │                           │
  │  5. deriveConversationKey(       │                           │
  │       sharedSecret, convId)      │                           │
  │     → HKDF 32-byte key           │                           │
  │                                  │                           │
  │  6. encryptMessage(              │                           │
  │       key, plaintext, idx)       │                           │
  │     → ChaCha20-Poly1305          │                           │
  │       ciphertext                 │                           │
  │                                  │                           │
  │  7. sendMessage(ciphertext) ────►│                           │
  │     (Stellar-signed HTTP POST)   │  stores ciphertext        │
  │                                  │  never decrypts           │
  │                                  │                           │
  │                                  │──► WebSocket push ───────►│
  │                                  │    or HTTP poll           │
  │                                  │                           │
  │                                  │         8. getMessages() ►│
  │                                  │◄── ciphertext array ──────│
  │                                  │                           │
  │                                  │    9. getDmKey(senderAddr)│
  │                                  │◄──────────────────────────│──► from contract
  │                                  │                           │
  │                                  │   10. deriveSharedSecret( │
  │                                  │         myPrivKey,        │
  │                                  │         senderPubKey)     │
  │                                  │                           │
  │                                  │   11. decryptMessage(     │
  │                                  │         key, ciphertext,  │
  │                                  │         idx)              │
  │                                  │       → plaintext         │
```

### Key registration

1. Each user calls `generateDmKeypair()` (in `packages/sdk/src/dm/crypto.ts`) to create an X25519 key pair. DM keys are **separate** from Stellar signing keys.
2. The public key is published on-chain via `publishDmKey(address, publicKey)` on the Linkora contract. This makes it discoverable by any other user without a central key server.
3. Before sending or receiving messages, both parties call `getDmKey(address)` to fetch each other's public key from the contract.

### Shared secret derivation

Both sender and recipient independently compute the same shared secret using X25519:

```
sharedSecret = X25519(myPrivateKey, theirPublicKey)
```

Because X25519 is commutative, both parties arrive at the same value without exchanging the secret itself. A per-conversation key is then derived with HKDF:

```
conversationKey = HKDF-SHA256(sharedSecret, info="linkora-dm-v1:<conversationId>")
```

where `conversationId` is `SHA256(sort([addressA, addressB]).join(""))` — deterministic and direction-independent.

### Per-message nonces

To prevent nonce reuse without requiring synchronisation, each message's 12-byte ChaCha20 nonce is derived from the conversation key and the message index:

```
nonce = HKDF-SHA256(conversationKey, info="nonce:<messageIndex>", length=12)
```

The message index is an application-level counter that increases monotonically within a conversation. Nonce reuse for the same conversation key would break the authenticated encryption guarantee, so correct index management is critical.

### Relay authentication

The relay rejects unauthenticated submissions. Every message `POST` must carry a Stellar-signed auth payload (`services/dm-relay/src/auth.ts`):

```
authMessage = SHA256("<to>:<nonce>:<timestamp>")
signature   = Ed25519_sign(senderPrivateKey, authMessage)
```

The relay verifies the signature and enforces a 30-second timestamp window to prevent replay attacks. A per-signature replay cache is maintained in memory for the duration of the skew window.

### Key rotation

Key rotation is not yet fully implemented. The planned flow is:

1. The user generates a new X25519 key pair and publishes it on-chain, overwriting the old public key.
2. The SDK's `detectKeyRotation()` function (in `packages/sdk/src/dm/relay.ts`) checks whether the on-chain public key differs from the key used to encrypt previous messages. If a rotation is detected, the client fetches the new key and uses it for subsequent messages.
3. Messages encrypted under the old key remain readable as long as the old private key is retained locally.

### Forward secrecy

The current scheme does **not** provide forward secrecy: the static X25519 key pair is long-lived, so an attacker who obtains a user's DM private key can decrypt all past messages they have access to.

Forward secrecy is planned for a future protocol version using a Double Ratchet or similar mechanism layered on top of the existing HKDF derivation.

### Code references

| Concern                                              | File                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| Key generation, HKDF derivation, encrypt/decrypt     | [`packages/sdk/src/dm/crypto.ts`](../packages/sdk/src/dm/crypto.ts)     |
| Relay HTTP client, WebSocket, key rotation detection | [`packages/sdk/src/dm/relay.ts`](../packages/sdk/src/dm/relay.ts)       |
| High-level `DmService` (key publish, send, receive)  | [`packages/sdk/src/dm/index.ts`](../packages/sdk/src/dm/index.ts)       |
| Relay server: Stellar signature verification         | [`services/dm-relay/src/auth.ts`](../services/dm-relay/src/auth.ts)     |
| Relay server: message routes                         | [`services/dm-relay/src/routes.ts`](../services/dm-relay/src/routes.ts) |

---

## 4. Database ownership

A service's `DATABASE_URL` selects its database. Use the deployment's actual
database and schema when tracing a row. The [base Compose file](../docker-compose.yml)
points the indexer, oracle, search and notification at the same PostgreSQL
database, while the [staging overlay](../docker-compose.staging.yml) gives
notification a separate database.

| Service | Schema owner and write path | Read consumers | Migration location |
| --- | --- | --- | --- |
| Indexer | Owns indexed contract data, including `raw_events`, profiles, posts, follows, tips and pools. The [ingestion pipeline](../services/indexer/src/pipeline.ts) commits raw events, [domain writes](../services/indexer/src/handlers) and the processed cursor in one transaction. The [notification service module](../services/indexer/src/notifications/service.ts) writes preferences and device tokens. The [event dispatcher](../services/indexer/src/notifications/events.ts) records push deduplication in `sent_notifications`. | [Indexer REST API](../services/indexer/src/api/index.ts) serves web and mobile clients. Search and the analytics oracle read the shared indexed data. | [Indexer SQL migrations](../services/indexer/migrations/README.md) and startup initialization in [`index.ts`](../services/indexer/src/index.ts). |
| DM relay | Owns `dm_messages` and `message_idempotency` in its relay database. [Relay database code](../services/dm-relay/src/database.ts) stores ciphertext and idempotency records, tracks delivery and removes expired records. | [Relay routes](../services/dm-relay/src/routes.ts) provide message retrieval to authenticated clients through the relay. | [Relay SQL migrations](../services/dm-relay/migrations) and [migration runner](../services/dm-relay/src/migrate.ts). |
| Notification | The [preferences module](../services/notification/src/preferences.ts) reads and upserts `notification_preferences` via the configured pool, with a process-local store when no pool is configured. The optional [in-app adapter](../services/notification/src/channels/inapp.ts) writes inbox rows and read flags when a caller wires it with a compatible schema. | The [preferences routes](../services/notification/src/index.ts) and [dispatcher](../services/notification/src/dispatcher.ts) read preferences. The in-app adapter broadcasts its inserted row to the caller's subscribers. | Standalone preference columns are created or extended in [`ensureTableColumns`](../services/notification/src/preferences.ts). On a shared database, [indexer migration 011](../services/indexer/migrations/011_notification_preferences.sql) defines the base preference table. |
| Search | Reads indexer-owned posts and profiles in the [search entry point](../services/search/src/index.ts). The separate [search indexing helper](../services/search/src/indexer.ts) contains writes to derived `search_vector` columns when wired. | Search API clients consume ranked results. | Search schema for the shared dataset lives in [indexer migrations](../services/indexer/migrations), including the [post FTS column](../services/indexer/migrations/009_posts_fts.sql) and [unified search view](../services/indexer/migrations/018_search_index.sql). |
| Analytics oracle | The [oracle query layer](../services/analytics-oracle/src/db.ts) reads the indexer's SQL data. The [oracle entry point](../services/analytics-oracle/src/index.ts) produces attestations for on-chain submission. | Oracle aggregation reads indexed activity such as posts, follows and tips. Consumers of signed attestations use the oracle API or chain. | Uses the [indexer migrations](../services/indexer/migrations) for shared tables. |

The [media service](../services/media/src/index.ts) processes uploaded image
bytes in its current entry point without a database connection. Redis caches
and rate-limit counters are operational state.

### Shared datasets and derived projections

- **Contract data.** The contract owns on-chain state. Indexer tables are
  off-chain projections of its events. The [cursor](../services/indexer/migrations/006_indexer_cursor.sql)
  tracks ingestion progress and the [state root](../services/indexer/src/stateRoot.ts)
  records a digest of processed state. Search and oracle consumers use the
  indexed copy, so their results depend on indexer freshness.
- **Search and ranking.** The [`search_index` view](../services/indexer/migrations/018_search_index.sql)
  derives from profiles and posts. The [score refresh job](../services/indexer/src/score-refresh.ts)
  refreshes `post_scores`, and the [reputation writer](../services/indexer/src/reputation.ts)
  maintains `reputation_scores`. Source record changes belong to the indexer
  ingestion path.
- **Notification data.** Both notification entry points can touch
  `notification_preferences` when pointed at the same schema. The indexer
  [sent-notification ledger](../services/indexer/migrations/008_sent_notifications.sql)
  tracks dispatch deduplication. The indexer
  [inbox definitions](../services/indexer/migrations/016_notifications.sql)
  [use different columns](../services/indexer/migrations/020_notifications.sql)
  from the standalone in-app adapter. Check the deployed table shape and the
  caller's SQL before assuming either inbox definition supports that adapter.

### Verification

Check `current_database()`, `current_schema()` and the deployed migration
history or schema against the write path above. Confirm the oracle role has
read access to shared tables, relay writes use the relay database, and
notification preference routes use the intended shared or separate schema.
See the [deployment migration steps](deployment.md#3-database-migration-steps)
and [migration CI workflow](../.github/workflows/migrations.yml).
