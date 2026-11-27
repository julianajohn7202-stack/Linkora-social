# System Architecture

This document describes the major components of the Linkora platform and how they interact.

---

## Table of Contents

1. [High-level overview](#1-high-level-overview)
2. [Component breakdown](#2-component-breakdown)
3. [DM encryption architecture](#3-dm-encryption-architecture)
4. [Transaction lifecycle troubleshooting](#4-transaction-lifecycle-troubleshooting)

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

## 4. Transaction lifecycle troubleshooting

| Stage               | Implementation                                                                                                                   | Symptoms and what to inspect                                                                                                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Signing             | The wallet signs the prepared XDR. The SDK queue accepts a signer, and the web transaction helper requests the wallet signature. | A dismissed prompt or explicit wallet rejection stops the attempt before submission. Check the wallet error and whether the client called the submission RPC.                                                                                                |
| Submission          | The client sends signed XDR with `sendTransaction` and records the returned hash.                                                | `PENDING` indicates acceptance for processing. `ERROR` indicates submission rejection. Inspect the submission response and its `errorResultXdr` when present. A transport timeout leaves the outcome uncertain, so look up the hash before submitting again. |
| Ledger confirmation | The client polls `getTransaction` using the hash.                                                                                | `SUCCESS` confirms execution and identifies the ledger. `FAILED` means execution failed on-chain. Inspect `resultXdr` and available diagnostic events for the cause.                                                                                         |
| Indexing            | The indexer ingests contract events and commits the domain rows and stream cursor to PostgreSQL.                                 | A successful transaction can precede visibility in the feed or other indexed reads. Compare the confirmation ledger with the indexer's committed cursor for the contract and query the affected read endpoint again.                                         |

### Inspect a known transaction hash

Use the same Stellar network as the wallet and application. Set `RPC_URL` to that network's RPC endpoint and `TX_HASH` to the 64-character hexadecimal hash from the wallet or submission response.

```bash
curl -sS "$RPC_URL" \
  -H 'Content-Type: application/json' \
  --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getTransaction\",\"params\":{\"hash\":\"$TX_HASH\"}}" | jq
```

1. Read `result.status`. For `NOT_FOUND`, verify the network and hash, then poll again if submission was recent. For older transactions, check the RPC's retained ledger range or use an explorer on the same network.
2. For `FAILED`, capture the hash, ledger and result or diagnostic details. Refreshing an indexed view cannot recover a failed operation.
3. For `SUCCESS`, record `result.ledger` and identify the affected entity from the transaction result or events. For example, query `GET /api/posts/<postId>` on the app's indexer after a successful post creation.
4. If the entity is missing and the indexer's `indexer_cursor.processed_cursor` for that contract is behind the confirmation ledger, allow ingestion to catch up and retry the read. If the cursor has reached or passed the ledger, check the contract ID, expected event, ingest logs and endpoint filters or caching. Preserve the original hash when investigating a confirmed write.

### Code references

| Concern                               | File                                                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Signing, submission and confirmation  | [SDK transaction queue](../packages/sdk/src/queue.ts), [web transaction helper](../apps/web/src/lib/tx.ts)           |
| Event processing and committed cursor | [Indexer pipeline](../services/indexer/src/pipeline.ts)                                                              |
| Post read endpoint                    | [Indexer post routes](../services/indexer/src/api/routes/posts.ts)                                                   |
| RPC response fields                   | [Stellar RPC getTransaction](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction) |
