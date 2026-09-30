# Linkora

[![CI](https://github.com/ijayabby/Linkora-social/actions/workflows/ci.yml/badge.svg)](https://github.com/ijayabby/Linkora-social/actions/workflows/ci.yml)
[![Contract Coverage](https://img.shields.io/badge/contract%20coverage-≥80%25-brightgreen)](https://github.com/ijayabby/Linkora-social/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Telegram](https://img.shields.io/badge/Telegram-Join-blue?logo=telegram)](https://t.me/+13csp8G4ccRhY2Zk)

---

## What is Linkora?

Linkora is an open-source SocialFi platform built on Stellar and Soroban. It combines social networking with on-chain financial primitives — creator profiles, follow graphs, posts, token tipping, community pools, and a mini app ecosystem — for creators, communities, and investors. The protocol is governed on-chain and designed to give creators direct ownership of their audience and revenue.

---

## Status

| Package                     | State                                           |
| --------------------------- | ----------------------------------------------- |
| `packages/contracts`        | ✅ Core social + DeFi primitives, unit tested   |
| `packages/sdk`              | 🔧 In progress — typed contract client          |
| `packages/reputation`       | 🔧 In progress — scaffolded                     |
| `packages/analytics`        | 🔧 In progress — scaffolded                     |
| `apps/web`                  | 🔧 In progress — Next.js web frontend           |
| `apps/mobile`               | 🔧 In progress — Expo / React Native mobile app |
| `services/indexer`          | 🔧 In progress — off-chain event indexer        |
| `services/dm-relay`         | 🔧 In progress — E2EE direct-message relay      |
| `services/analytics-oracle` | 🔧 In progress — on-chain analytics oracle      |
| `services/notification`     | 🔧 In progress — scaffolded                     |
| `services/search`           | 🔧 In progress — scaffolded                     |
| `services/media`            | 🔧 In progress — scaffolded                     |
| `examples/mini-apps`        | ✅ Example mini apps available                  |

---

## Architecture

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
│  TransactionQueue    │   └─────────────────────────────────────┘
└──────────┬───────────┘                   │  REST / WebSocket
           │                               ▼
           │              ┌────────────────────────────────────┐
           └─────────────►│  Web (apps/web) · Mobile (apps/mobile) │
                          │  Next.js 15 · Expo / React Native  │
                          └────────────────────────────────────┘
```

---

## Quick Start

```bash
# 1. Clone and run the setup script (checks prerequisites, installs deps, builds contracts)
./scripts/setup.sh

# 2. Web frontend
cd apps/web && pnpm dev           # http://localhost:3000

# 3. Mobile app
cd apps/mobile && pnpm start      # press 'a' (Android) or 'i' (iOS)

# 4. Indexer
cd services/indexer
cp .env.example .env              # fill in DATABASE_URL and SOROBAN_RPC_URL
pnpm dev

# 5. Contract tests
pnpm --filter contracts test      # or: cd packages/contracts && cargo test
```

---

## Local Database Backup & Restore

The Makefile includes targets for backing up and restoring the local development PostgreSQL database.

```bash
# Create a timestamped dump in ./backups/
make db-backup

# Restore from a previously created dump
make db-restore file=backups/linkora_20240924_120000.dump
```

Backups are written as PostgreSQL custom-format (`.dump`) files to the `./backups/` directory.
The PostgreSQL Docker Compose service must be running before executing either command.
Override `POSTGRES_USER`, `POSTGRES_PASSWORD`, or `POSTGRES_DB` if you use non-default credentials.

---

## Testing

```bash
# Contract unit tests
pnpm --filter contracts test

# Indexer database migrations (requires Docker + Compose v2)
# Spins up a throwaway PostgreSQL, applies all migrations forward, checks the
# schema against the committed snapshot, verifies idempotency on re-apply, and
# tears the database down. Runs in well under a minute.
bash tests/migrations/test-migrations.sh
```

See [`services/indexer/migrations/README.md`](./services/indexer/migrations/README.md)
for the migration authoring rules, reversibility policy, and how to refresh the
schema snapshot after an intentional change.

---

## Documentation

| Document                                                         | Description                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------- |
| [Contract API Reference](./docs/CONTRACT_API.md)                 | Full function reference, storage layout, and event schema |
| [System Architecture](./docs/ARCHITECTURE.md)                    | Component overview and data flows                         |
| [Design System](./docs/design/README.md)                         | UI/UX specifications and brand identity                   |
| [Mobile UI Spec](./docs/design/MOBILE_SPEC.md)                   | Screen inventory, components, tokens, accessibility       |
| [Mobile Developer Guide](./docs/mobile/DEVELOPER_GUIDE.md)       | Expo setup, simulators, EAS builds                        |
| [Indexer Design](./docs/indexer/INDEXER_DESIGN.md)               | Event indexing strategy and search API                    |
| [Indexer Migrations](./services/indexer/migrations/README.md)    | Migration rules, reversibility policy, and testing        |
| [Mini Apps Developer Guide](./docs/mini-apps/DEVELOPER_GUIDE.md) | Build and submit a Linkora mini app                       |
| [Mini Apps Bridge API](./docs/mini-apps/BRIDGE_API.md)           | Bridge method reference                                   |
| [Security Policy](./SECURITY.md)                                 | Vulnerability disclosure guidance                         |

---

## Deploying New Modules

The main contract (`linkora-contracts`) already includes governance, moderation, reputation, and rewards logic as modules within a single Soroban contract binary. Deploying "new modules" therefore means deploying an **upgraded version** of the main contract with the new functionality compiled in, then initialising or configuring the module-specific state.

### Prerequisites

- `stellar-cli` installed (`cargo install --locked stellar-cli`)
- A funded testnet account — get free XLM from the [Stellar Testnet Faucet](https://laboratory.stellar.org/#account-creator?network=test)
- `ADMIN_SECRET` and `TREASURY_ADDRESS` environment variables set

```bash
# Fund a fresh keypair via friendbot
stellar keys generate linkora_deployer --network testnet
stellar keys fund linkora_deployer --network testnet
```

### Step 1 — Build the contract

```bash
cd packages/contracts/contracts/linkora-contracts
stellar contract build
# Produces: target/wasm32v1-none/release/linkora_contracts.wasm
```

### Step 2 — Deploy or upgrade the main contract

**First-time deploy:**

```bash
ADMIN_SECRET=S... TREASURY_ADDRESS=G... FEE_BPS=250 ./scripts/deploy_testnet.sh
# Prints: contract_id=C...
```

**Upgrade an existing deployment** (when new module code is added):

```bash
# 1. Upload the new WASM and get its hash
NEW_HASH=$(stellar --config-dir "$CFG_DIR" contract install \
  --network testnet \
  --source-account linkora_deployer \
  --wasm packages/contracts/contracts/linkora-contracts/target/wasm32v1-none/release/linkora_contracts.wasm)

# 2. Propose the upgrade on-chain (requires upgrader role)
stellar contract invoke \
  --network testnet \
  --source-account linkora_deployer \
  --id "$CONTRACT_ID" \
  -- propose_upgrade \
    --upgrader "$ADMIN_ADDRESS" \
    --new-wasm-hash "$NEW_HASH"

# 3. Execute after the time-lock window passes
stellar contract invoke \
  --network testnet \
  --source-account linkora_deployer \
  --id "$CONTRACT_ID" \
  -- execute_upgrade \
    --upgrader "$ADMIN_ADDRESS"
```

### Step 3 — Initialise module state

After deploying or upgrading, configure each module once:

#### Governance

```bash
# Initialise governance configuration (quorum, voting window, time-lock)
stellar contract invoke \
  --network testnet \
  --source-account linkora_deployer \
  --id "$CONTRACT_ID" \
  -- gov_init_config \
    --admin "$ADMIN_ADDRESS" \
    --quorum-bps 2000 \
    --voting-period-ledgers 17280 \
    --timelock-ledgers 720 \
    --veto-threshold-bps 3000 \
    --min-proposal-deposit 1000000
```

#### Moderation

No separate initialisation step is required — moderation (post reporting, report review, `MODERATOR` role grants) is available immediately after the contract is deployed. Grant the moderator role to trusted accounts:

```bash
stellar contract invoke \
  --network testnet \
  --source-account linkora_deployer \
  --id "$CONTRACT_ID" \
  -- grant_role \
    --admin "$ADMIN_ADDRESS" \
    --account "$MODERATOR_ADDRESS" \
    --role Moderator
```

#### Reputation / Rewards

Reputation accrues automatically from on-chain activity (tips received, likes, follows). The rent and rewards rate can be tuned via admin calls:

```bash
# Set tip cooldown window (ledgers between tips to the same post)
stellar contract invoke \
  --network testnet \
  --source-account linkora_deployer \
  --id "$CONTRACT_ID" \
  -- set_tip_cooldown_window \
    --admin "$ADMIN_ADDRESS" \
    --cooldown-ledgers 100

# Set rent rate (basis points per ledger)
stellar contract invoke \
  --network testnet \
  --source-account linkora_deployer \
  --id "$CONTRACT_ID" \
  -- set_rent_rate_bps \
    --admin "$ADMIN_ADDRESS" \
    --rate 10
```

### Step 4 — Link the Token Factory (optional)

If your deployment also uses the token factory contract for creator tokens:

```bash
# Deploy the token factory
TOKEN_FACTORY_ID=$(stellar --config-dir "$CFG_DIR" contract deploy \
  --network testnet \
  --source-account linkora_deployer \
  --wasm packages/contracts/contracts/token-factory/target/wasm32v1-none/release/token_factory.wasm)

echo "token_factory_id=$TOKEN_FACTORY_ID"
# Pass tokenFactoryId to LinkoraClient when constructing the SDK client
```

### Dry-run mode

All deploy scripts support `--dry-run` to validate configuration without submitting any transactions:

```bash
ADMIN_SECRET=S... TREASURY_ADDRESS=G... ./scripts/deploy_testnet.sh --dry-run
```

### Environment variables reference

| Variable           | Required | Description                                          |
| ------------------ | -------- | ---------------------------------------------------- |
| `ADMIN_SECRET`     | Yes      | Secret key (`S...`) of the deployer / admin account  |
| `TREASURY_ADDRESS` | Yes      | Public key (`G...`) that receives protocol fees      |
| `FEE_BPS`          | No       | Protocol fee in basis points (default `0`)           |
| `CONTRACT_ID`      | No       | Skip deploy and use an existing contract ID (`C...`) |
| `NETWORK`          | No       | Stellar network name (default `testnet`)             |

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to set up your environment, branch conventions, and the PR process.

---

## Troubleshooting

| Problem                                             | Fix                                                                     |
| --------------------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm: command not found`                           | `npm install -g pnpm`                                                   |
| `cargo: command not found`                          | `curl https://sh.rustup.rs -sSf \| sh && source $HOME/.cargo/env`       |
| `cargo test` fails with "no such file or directory" | Run from the contracts directory: `cd packages/contracts && cargo test` |
| `stellar: command not found`                        | `cargo install --locked stellar-cli --features opt`                     |

---

## License

[MIT](./LICENSE)
