# Contributing to Linkora

Thank you for your interest in contributing! This guide covers everything you
need to get your environment ready, follow our branch conventions, and get a PR
merged.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Development Setup](#development-setup)
3. [Branch Conventions](#branch-conventions)
4. [Commit Guidelines](#commit-guidelines)
5. [Pull Request Process](#pull-request-process)
6. [Branch Protection Rules](#branch-protection-rules)
7. [Environment Configuration](#environment-configuration)
8. [Code Style](#code-style)
9. [Testing](#testing)

---

## Prerequisites

| Tool           | Minimum version     | Notes                                |
| -------------- | ------------------- | ------------------------------------ |
| Node.js        | See `.node-version` | Managed via `nvm` or `fnm`           |
| pnpm           | 9.x                 | `npm i -g pnpm`                      |
| Rust           | stable              | `rustup toolchain install stable`    |
| Docker         | 24+                 | Required for integration tests       |
| Docker Compose | v2                  | Bundled with Docker Desktop          |
| stellar-cli    | latest              | `cargo install --locked stellar-cli` |

Run `./scripts/setup.sh` after cloning — it checks all prerequisites, installs
dependencies, and builds the contracts.

---

## Development Setup

```bash
# 1. Fork and clone
git clone https://github.com/<your-handle>/Linkora-social.git
cd Linkora-social

# 2. Add the canonical upstream remote
git remote add upstream https://github.com/julianajohn7202-stack/Linkora-social.git

# 3. Run the setup script
./scripts/setup.sh

# 4. Start the local stack
docker compose up -d

# 5. Start the web frontend
cd apps/web && pnpm dev   # http://localhost:3000
```

---

## Branch Conventions

| Type    | Pattern                            | Example                         |
| ------- | ---------------------------------- | ------------------------------- |
| Feature | `feat/<issue>-short-description`   | `feat/42-creator-profiles`      |
| Bug fix | `fix/<issue>-short-description`    | `fix/99-follow-count-overflow`  |
| Chore   | `chore/<issue>-short-description`  | `chore/120-update-dependencies` |
| Docs    | `docs/<issue>-short-description`   | `docs/55-indexer-design`        |
| DevOps  | `devops/<issue>-short-description` | `devops/288-branch-protection`  |

Rules:

- Branch off from `main`. Always rebase on `upstream/main` before opening a PR.
- Use lowercase kebab-case.
- Include the issue number when one exists.
- Keep branches focused — one logical change per branch.

---

## Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

[optional body]

[optional footer — e.g. Closes #42]
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`, `style`.

Examples:

```
feat(contracts): add post-moderation hook
fix(indexer): handle null ledger sequence on genesis block
docs(contributing): add branch protection rules section
```

---

## Pull Request Process

1. **Rebase** your branch on the latest `upstream/main` before opening a PR:

   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Push** your branch to your fork:

   ```bash
   git push -u origin <branch-name>
   ```

3. **Open** a PR against `julianajohn7202-stack/Linkora-social:main`.

4. **Title**: keep it under 70 characters and use the Conventional Commits
   format (e.g. `feat(sdk): add typed tip client`).

5. **Description**: explain _what_ was implemented and reference the issue
   with `Closes #<issue>`.

6. **Wait for CI** — all required status checks must pass before merging.

7. A maintainer will review and approve. Address any requested changes by
   pushing additional commits (do **not** force-push after review has started).

8. Once approved and green, the PR will be merged using **rebase merge** to
   keep a linear history on `main`.

---

## Branch Protection Rules

The `main` branch is protected with the following rules enforced via GitHub
repository settings:

| Rule                                      | Setting                                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| Require pull request before merging       | ✅ Enabled                                                                                    |
| Required approving reviews                | **1** (minimum)                                                                               |
| Dismiss stale reviews on new push         | ✅ Enabled                                                                                    |
| Require status checks to pass             | ✅ Enabled                                                                                    |
| Required status checks                    | `CI / JS/TS — typecheck, test, build`<br>`CI / Lint TypeScript Packages`<br>`CI / Unit Tests` |
| Require branches to be up to date         | ✅ Enabled                                                                                    |
| Require linear history (no merge commits) | ✅ Enabled                                                                                    |
| Do not allow force pushes                 | ✅ Enabled                                                                                    |
| Do not allow deletions                    | ✅ Enabled                                                                                    |

### Why these rules?

- **PR reviews** catch bugs and keep the team aligned before code lands.
- **Status checks** ensure every merge passes typecheck, lint, unit tests, and
  contract tests — so `main` is always deployable.
- **Linear history** makes `git bisect` reliable and the log easy to read.
  Use `git rebase` instead of merge commits when incorporating upstream changes.

### Applying the rules (maintainers only)

For maintainers, these settings live in:
**GitHub → Settings → Branches → Branch protection rules → `main`**.

A GitHub CLI command to apply them (requires `admin` scope):

```bash
gh api repos/julianajohn7202-stack/Linkora-social/branches/main/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["CI / JS/TS — typecheck, test, build","CI / Lint TypeScript Packages","CI / Unit Tests"]}' \
  --field enforce_admins=false \
  --field required_pull_request_reviews='{"required_approving_review_count":1,"dismiss_stale_reviews":true}' \
  --field restrictions=null \
  --field required_linear_history=true \
  --field allow_force_pushes=false \
  --field allow_deletions=false
```

---

## Environment Configuration

Local, staging, and release environments each draw configuration from different
sources. Knowing the source of truth for each environment prevents secrets
leaking into source control and avoids broken deployments caused by mismatched
values.

### Environment matrix

| Environment              | Source of truth                                                                           | Responsible owner   | Notes                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------- |
| **local**                | `.env` file (git-ignored) + `docker-compose.yml` defaults                                 | Developer           | Copy `.env.example`; never commit this file               |
| **testnet / staging**    | GitHub Actions environment `staging` (secrets + variables) + `docker-compose.staging.yml` | DevOps / maintainer | Populated via repo **Settings → Environments → staging**  |
| **release / production** | Kubernetes Secrets (`linkora-secrets`) + manifests in `infra/`                            | Maintainer          | Rotated through a secrets manager; never stored in source |

### Variable precedence

When a service starts, values are resolved in this order (first match wins):

1. Shell environment variable (injected by CI, Docker Compose `environment:`, or Kubernetes Secret)
2. `.env` file in the project root (local development only)
3. `docker-compose.yml` default value in the `environment:` block
4. Application hard-coded default (e.g. `PORT=3000`)

A value set in GitHub Actions secrets always overrides a `.env` file because CI
injects it directly into the shell environment.

### Testnet and staging source of truth

Testnet and staging variables are owned by the GitHub Actions environment named
**`staging`** (repo **Settings → Environments → staging**). The
`.github/workflows/deploy-staging.yml` workflow reads from this environment
automatically on every push to `main` that touches a service directory.

Required secrets and variables in the `staging` environment:

| Name                 | Type     | Description                                     |
| -------------------- | -------- | ----------------------------------------------- |
| `STAGING_SSH_KEY`    | Secret   | Private SSH key for the staging host            |
| `STAGING_HOST`       | Variable | Staging server hostname or IP                   |
| `STAGING_USER`       | Variable | SSH login user (default `ubuntu`)               |
| `STAGING_DEPLOY_DIR` | Variable | Project root path on the staging host           |
| `STAGING_BASE_URL`   | Variable | Base URL shown as the environment URL in GitHub |

`CONTRACT_ID` and `START_LEDGER` for testnet are also set as variables in the
`staging` environment and must match the latest testnet contract deployment.
Update them whenever a new contract is deployed to testnet.

### Local setup examples

Copy `.env.example` to `.env` and fill in the placeholder values. The file is
listed in `.gitignore` — never commit it.

```bash
# .env — local development only, never commit this file
POSTGRES_PASSWORD=your-local-db-password
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
CONTRACT_ID=CABC...EXAMPLE          # Replace with your deployed testnet contract ID
START_LEDGER=12345678               # Ledger sequence of the contract deployment
ADMIN_SECRET=a-long-random-string   # Required only for oracle admin calls locally
STELLAR_NETWORK=Testnet
NETWORK_PASSPHRASE=Test SDF Network ; September 2015
CORS_ORIGIN=http://localhost:3000
```

Staging values are **not** placed in `.env`. They live exclusively in GitHub
Actions environment secrets and variables so that they are never present on a
developer's workstation or in source control.

---

## Code Style

- **TypeScript**: enforced by ESLint (`pnpm lint`) and Prettier (`pnpm format`).
  Config lives in `.eslintrc.base.json` and `.prettierrc`.
- **Rust**: enforced by `rustfmt` and `clippy`. Run `cargo fmt` and
  `cargo clippy -- -D warnings` before pushing.
- A pre-commit hook (Husky) runs linting automatically on staged files.

---

## Testing

```bash
# TypeScript unit tests
pnpm test

# Contract unit + fuzz tests
pnpm --filter contracts test

# Integration tests (requires Docker)
bash tests/integration/run_e2e.sh

# Migration tests (requires Docker)
bash tests/migrations/test-migrations.sh
```

All tests must pass locally before opening a PR. CI will re-run them on every
push to a PR branch and on every push to `main`.

### Local web E2E fixtures

The [fixture server](apps/web/e2e-mocks/server.js) serves mock indexer endpoints
on port 3001 and mock Soroban RPC on port 8000. Use it with the built Next.js
app, as in the [frontend E2E workflow](.github/workflows/frontend-e2e.yml).
Keep ports 3000, 3001, and 8000 free before starting.

From the repository root, after installing workspace dependencies, start the
fixture server in one terminal.

```bash
node apps/web/e2e-mocks/server.js
```

In a second terminal at the repository root, install Chromium, build with the
local fixture URLs, and run a single spec. Playwright starts the built web app
on port 3000 according to [its configuration](apps/web/playwright.config.ts).

```bash
pnpm --filter apps-web exec playwright install chromium
export NEXT_PUBLIC_API_URL=http://localhost:3001
export NEXT_PUBLIC_INDEXER_URL=http://localhost:3001
export NEXT_PUBLIC_INDEXER_API_URL=http://localhost:3001
export NEXT_PUBLIC_SOROBAN_RPC_URL=http://localhost:8000/rpc
export NEXT_PUBLIC_NETWORK_PASSPHRASE='Standalone Network ; February 2017'
export NEXT_PUBLIC_CONTRACT_ID=CBQHLSNMBF4HS3UX2PV72T75V2SXE7M2EZZTQ6YC5DSXIGGY4NPSAFAF
pnpm --filter apps-web build
pnpm --filter apps-web test:e2e search-suggestions.spec.ts
```

To extend a scenario, put this example in its own spec under
`apps/web/tests/e2e/` and pass that filename to `test:e2e`.
[The shared wallet helper](apps/web/tests/e2e/test-utils.ts) seeds a connected
test address and completed onboarding before navigation. Each Playwright test
gets its own page and browser context. Keep route overrides and response data
within that test so parallel workers can continue to use the shared server.

```ts
import { expect, test } from "@playwright/test";
import { injectWalletMock, MOCK_ADDRESS } from "./test-utils";

test("clears profile suggestions when a later lookup fails", async ({ page }) => {
  await injectWalletMock(page);
  await page.route(/\/api\/profiles\/search\?/, async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    const headers = { "access-control-allow-origin": "*" };

    if (query === "offline") {
      await route.fulfill({ status: 503, headers, json: { error: "fixture unavailable" } });
      return;
    }

    const profiles =
      query === "fixture"
        ? [{ address: MOCK_ADDRESS, username: "fixture", display_name: "Fixture Profile" }]
        : [];
    await route.fulfill({ status: 200, headers, json: { profiles } });
  });

  await page.goto("/");
  const search = page.getByRole("search").first().locator("input");
  const suggestion = page.locator("#search-suggestions").getByText("Fixture Profile");
  await search.focus();
  await search.fill("fixture");
  await expect(suggestion).toBeVisible();

  const failedLookup = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/profiles/search" && url.searchParams.get("q") === "offline";
  });
  await search.fill("offline");
  expect((await failedLookup).status()).toBe(503);
  await expect(suggestion).toBeHidden();
});
```
