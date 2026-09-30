# Contributing to Linkora

Thanks for your interest in contributing! This guide covers everything you need
to get your environment running, make a change, and get it merged.

---

## Table of Contents

1. [Environment Setup](#environment-setup)
2. [Branch Naming Conventions](#branch-naming-conventions)
3. [Running Tests](#running-tests)
4. [Lockfile Management](#lockfile-management)
5. [PR Process](#pr-process)

---

## Environment Setup

### Prerequisites

| Tool        | Minimum version | Install                                      |
| ----------- | --------------- | -------------------------------------------- |
| Node.js     | see `.node-version` | [nodejs.org](https://nodejs.org)         |
| pnpm        | 9.x             | `npm install -g pnpm`                        |
| Rust        | stable          | [rustup.rs](https://rustup.rs)               |
| Docker      | 24+             | [docker.com](https://www.docker.com)         |
| Stellar CLI | latest          | [stellar.org/docs](https://stellar.org/docs) |

### Quickstart

```bash
# Clone the repo
git clone https://github.com/ijayabby/Linkora-social.git
cd Linkora-social

# Run the automated setup script — checks prerequisites, installs deps, and
# builds the contracts
./scripts/setup.sh
```

The setup script will:

- Verify all prerequisites are installed and meet minimum versions
- Run `pnpm install` to install all JavaScript/TypeScript dependencies
- Build the Soroban smart contracts with `cargo build`

### Manual setup

If you prefer to set things up by hand:

```bash
# Install JS/TS dependencies (uses the committed pnpm-lock.yaml)
pnpm install

# Build contracts
cd packages/contracts && cargo build --target wasm32v1-none --release
```

---

## Branch Naming Conventions

Use one of the following prefixes so that CI labels and GitHub automation work
correctly:

| Prefix    | Use for                                         | Example                        |
| --------- | ----------------------------------------------- | ------------------------------ |
| `feat/`   | New features or capabilities                    | `feat/add-tipping-ui`          |
| `fix/`    | Bug fixes                                       | `fix/lockfile-drift`           |
| `chore/`  | Maintenance, dependency bumps, tooling          | `chore/upgrade-pnpm-9`         |
| `docs/`   | Documentation-only changes                     | `docs/update-contributing`     |
| `refactor/` | Code restructuring with no behaviour change   | `refactor/sdk-client-cleanup`  |
| `test/`   | Adding or updating tests                        | `test/coverage-governance`     |

Always branch off `main`:

```bash
git checkout main && git pull
git checkout -b feat/<short-description>
```

---

## Running Tests

### JavaScript / TypeScript

```bash
# Run all JS/TS tests (unit + component) across the monorepo
pnpm test

# Run tests for a single package
pnpm --filter @linkora/sdk test
pnpm --filter indexer test
```

### Rust (Soroban contracts)

```bash
# From the repo root
pnpm --filter contracts test

# Or directly with cargo
cd packages/contracts && cargo test
```

### Migration tests

The migration test suite spins up a throwaway PostgreSQL container, runs all
migrations, validates the schema snapshot, and checks idempotency:

```bash
bash tests/migrations/test-migrations.sh
```

Requires Docker Compose v2.

### Integration / E2E tests

```bash
# Runs against a local Stellar sandbox (requires Docker + stellar-cli)
pnpm test:integration
```

See [`tests/integration/run_e2e.sh`](./tests/integration/run_e2e.sh) for
details.

---

## Lockfile Management

### Why the lockfile is committed

`pnpm-lock.yaml` is committed to the repository so that every developer,
every CI run, and every deployment uses exactly the same dependency tree.
This eliminates "works on my machine" issues caused by transitive dependency
drift.

### How CI enforces it

The `lockfile-check` job in `.github/workflows/ci.yml` runs **before** any
other JavaScript job and performs two checks:

1. `pnpm install --frozen-lockfile` — pnpm aborts with a clear error if
   `pnpm-lock.yaml` does not satisfy all `package.json` files in the workspace.
2. `git diff --exit-code pnpm-lock.yaml` — fails the job if a frozen install
   somehow produced a modified lockfile, catching any remaining drift.

The `js-ci` and `lint` jobs both declare `needs: lockfile-check`, so they are
skipped entirely if the lockfile is out of date, giving contributors a fast,
clear failure rather than a confusing downstream error.

### How to update the lockfile

Whenever you add, remove, or change a dependency in any `package.json`, you
**must** regenerate the lockfile and commit it together with your change:

```bash
# After editing package.json (add/remove/change a dependency)
pnpm install

# Verify the lockfile is now in sync
git diff pnpm-lock.yaml   # review the diff

# Stage and commit both files together
git add package.json pnpm-lock.yaml
git commit -m "chore: add <package-name>"
```

Common scenarios:

```bash
# Add a runtime dependency to a specific package
pnpm --filter apps/web add react-query

# Add a dev dependency to the workspace root
pnpm add -D -w some-tool

# Remove a dependency
pnpm --filter apps/web remove old-package

# Upgrade all dependencies (use with care — review the diff)
pnpm update
```

After any of these commands, `pnpm-lock.yaml` will be modified. Always
commit it in the same PR as the `package.json` change.

### Fixing a failing lockfile check

If the `lockfile-check` CI job fails on your PR, it means `pnpm-lock.yaml` is
not in sync with the `package.json` files in your branch. To fix it:

```bash
# Regenerate the lockfile from your current package.json files
pnpm install

# Commit the updated lockfile
git add pnpm-lock.yaml
git commit -m "chore: sync pnpm lockfile"
git push
```

---

## PR Process

1. **Open a PR against `main`** with a clear title following
   [Conventional Commits](https://www.conventionalcommits.org/):
   `feat(sdk): add typed pool client`.

2. **Fill in the PR template** — describe the change, how it was tested, and
   reference the issue it closes (`Closes #NNN`).

3. **All CI checks must pass** before a review is requested:
   - `lockfile-check` — lockfile is in sync
   - `js-ci` — TypeScript typechecks, tests, and build pass
   - `lint` — no lint errors
   - `unit-tests` — Rust contract tests pass

4. **Request a review** from at least one codeowner (see
   [`.github/CODEOWNERS`](./.github/CODEOWNERS)).

5. **Address review comments** with new commits — do not force-push once a
   review is in progress.

6. **Squash and merge** — the project uses squash merges on `main` to keep the
   commit history clean.

### Commit message conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]

[optional footer: Closes #NNN]
```

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`, `ci`.

Husky runs a commit-msg hook to enforce this format locally.
