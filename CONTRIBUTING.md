# Contributing to Linkora

Thank you for your interest in contributing to Linkora! This guide covers
everything you need to get up and running, from local setup through submitting
a pull request and understanding how production deployments are protected.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Local Setup](#local-setup)
3. [Project Structure](#project-structure)
4. [Branch Conventions](#branch-conventions)
5. [Making Changes](#making-changes)
6. [Pull Requests](#pull-requests)
7. [Testing](#testing)
8. [Code Style](#code-style)
9. [Production Deployments](#production-deployments)
10. [Reporting Issues](#reporting-issues)
11. [License](#license)

---

## Prerequisites

| Tool                | Minimum version     | Notes                                              |
| ------------------- | ------------------- | -------------------------------------------------- |
| Node.js             | See `.node-version` | Use `nvm use` or `fnm use` to switch automatically |
| pnpm                | 9+                  | `npm install -g pnpm`                              |
| Rust + Cargo        | stable              | Required for smart contract work                   |
| Docker + Compose v2 | Latest              | Required for local services and migration tests    |
| `gh` CLI            | 2+                  | Required to create PRs from the terminal           |

---

## Local Setup

```bash
# 1. Clone the repository
git clone https://github.com/julianajohn7202-stack/Linkora-social.git
cd Linkora-social

# 2. Run the automated setup script
#    (checks prerequisites, installs deps, builds contracts)
./scripts/setup.sh

# 3. Copy example environment files
cp services/indexer/.env.example    services/indexer/.env
cp services/dm-relay/.env.example   services/dm-relay/.env
# Fill in DATABASE_URL, SOROBAN_RPC_URL, etc. as instructed in each file.

# 4. Start the local database stack
docker compose up -d postgres redis

# 5. Start a specific service in watch mode
pnpm --filter @linkora/indexer dev          # indexer
pnpm --filter linkora-dm-relay  dev         # DM relay

# Or use the convenience Makefile targets:
make notification   # notification service
make search         # search service
make media          # media service
make services       # all services in parallel
```

### Web & Mobile

```bash
# Web frontend
cd apps/web && pnpm dev           # http://localhost:3000

# Mobile app (Expo)
cd apps/mobile && pnpm start      # press 'a' (Android) or 'i' (iOS)
```

---

## Project Structure

```
apps/
  web/              Next.js 15 web frontend
  mobile/           Expo / React Native mobile app
packages/
  contracts/        Soroban smart contracts (Rust)
  sdk/              Typed contract client
  types/            Shared TypeScript types
services/
  indexer/          Off-chain event indexer
  dm-relay/         E2EE direct-message relay
  analytics-oracle/ On-chain analytics oracle
  notification/     Push-notification service
  search/           Full-text search service
  media/            Media upload / processing service
examples/           SDK and mini-app examples
docs/               Architecture, API, and design docs
scripts/            Setup, release, and deploy helpers
tests/              Integration and migration tests
```

---

## Branch Conventions

| Prefix                    | When to use                                 |
| ------------------------- | ------------------------------------------- |
| `feat/<issue>-<slug>`     | New feature or enhancement                  |
| `fix/<issue>-<slug>`      | Bug fix                                     |
| `chore/<issue>-<slug>`    | Tooling, CI, dependency updates             |
| `docs/<issue>-<slug>`     | Documentation only                          |
| `refactor/<issue>-<slug>` | Code restructuring without behaviour change |

**Examples**

```
feat/282-github-environment-protection
fix/310-ws-reconnect-backoff
chore/295-bump-stellar-sdk
```

Always branch off `main`:

```bash
git checkout main && git pull origin main
git checkout -b feat/<issue>-<slug>
```

---

## Making Changes

1. **Read the issue** — understand the acceptance criteria before writing code.
2. **Keep changes focused** — one issue per branch. Avoid unrelated cleanup in
   the same PR.
3. **Follow existing patterns** — match the logging, error handling, and
   project structure of the service you are modifying.
4. **Add or update tests** — new features and bug fixes should include test
   coverage. See [Testing](#testing) below.
5. **Update documentation** — if you change a public API or add a new service,
   update the relevant docs under `docs/`.

---

## Pull Requests

1. Push your branch and open a PR against `main` on the upstream repository:

   ```bash
   git push -u origin feat/<issue>-<slug>

   gh pr create \
     --repo julianajohn7202-stack/Linkora-social \
     --base main \
     --head <your-fork>:feat/<issue>-<slug> \
     --title "feat: short description" \
     --body "..."
   ```

2. **PR title** — use a conventional commit prefix (`feat:`, `fix:`, `chore:`,
   `docs:`, `refactor:`) followed by a concise description (≤ 70 characters).

3. **PR description** must include:
   - A summary of what was implemented
   - A `Closes #<issue-number>` line so the issue auto-closes on merge

4. **CI must pass** — all status checks (lint, typecheck, tests, contract
   build) must be green before a reviewer will look at your PR.

5. **One approval required** — at least one maintainer must approve before
   merging.

---

## Testing

```bash
# JS/TS unit tests (all packages and services)
pnpm test

# Smart contract unit + fuzz tests
pnpm --filter contracts test
# or: cd packages/contracts && cargo test

# All service tests via Makefile
make test-services

# Migration tests (requires Docker)
bash tests/migrations/test-migrations.sh

# Integration / E2E (nightly; requires Docker + stellar-cli)
pnpm test:integration
```

---

## Code Style

- **TypeScript** — ESLint + Prettier. Run `pnpm lint` and `pnpm format` before
  committing. A pre-commit hook enforces this automatically.
- **Rust** — `rustfmt` and `clippy`. The CI runs `cargo fmt --check` and
  `cargo clippy -- -D warnings`.
- **Commit messages** — follow
  [Conventional Commits](https://www.conventionalcommits.org/). The commit
  message format is: `<type>(<optional scope>): <description>`.

---

## Production Deployments

### How it works

Every merge to `main` that has the required secrets configured triggers the
`Deploy Testnet` workflow (`.github/workflows/deploy-testnet.yml`). The
workflow's `deploy` job is gated by the **`production` GitHub environment**,
which requires explicit approval from one or more designated reviewers before
the job runs.

This means:

1. A push to `main` triggers the workflow.
2. The workflow pauses at the `deploy` job and sends an approval request to all
   required reviewers via GitHub notification / email.
3. A reviewer inspects the changes and clicks **Approve** (or **Reject**) in
   the GitHub Actions UI.
4. Only after approval does the deployment proceed.

All deployments — successful and rejected — are recorded in the **Environments**
tab of the repository, giving a full audit trail.

### Setting up the environment (admins only)

The `production` environment must be created once by a repository administrator:

1. Go to **Settings → Environments → New environment** in the GitHub
   repository.
2. Name it exactly `production`.
3. Enable **Required reviewers** and add the appropriate team(s) or
   individual(s).
4. Set **Deployment branch policy → Selected branches** and allow only `main`.
5. Optionally enable **Prevent self-review**.
6. Save.

See `.github/environments/production.yml` for a full reference of the expected
settings.

### Why this matters

Without environment protection, any workflow job can deploy to production
without human oversight. A misconfigured secret, a bad merge, or an automated
dependency bump could silently break the live environment. The approval gate
ensures at least one human reviews the intent before production is touched.

---

## Reporting Issues

Use the issue templates in `.github/ISSUE_TEMPLATE/` to file bug reports,
feature requests, or contract issues. For security vulnerabilities, see
[SECURITY.md](./SECURITY.md).

---

## License

By contributing you agree that your contributions will be licensed under the
[MIT License](./LICENSE).
