.PHONY: dev build lint test format labels \
        notification search media services test-services

dev:
	@pnpm dev

build:
	@pnpm build

lint:
	@pnpm lint

test:
	@pnpm test

format:
	@pnpm format

# -----------------------------------------------------------------
# Service targets
# -----------------------------------------------------------------

# Start the notification service in development mode.
notification:
	@pnpm --filter @linkora/notification dev

# Start the search service in development mode.
search:
	@pnpm --filter @linkora/search dev

# Start the media service in development mode.
media:
	@pnpm --filter @linkora/media dev

# Start all services (indexer, dm-relay, analytics-oracle,
# notification, search, media) in parallel.
services:
	@pnpm -r --filter './services/**' dev

# Run tests for all services.
test-services:
	@pnpm --filter './services/**' test

# Sync GitHub issue/PR labels from .github/labels.yml to the repository.
# Requires the GITHUB_TOKEN env var (a token with repo scope). The target
# repository is derived from the `origin` git remote.
labels:
	@test -n "$(GITHUB_TOKEN)" || { echo "GITHUB_TOKEN is not set"; exit 1; }
	@repo=$$(git remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$$##'); \
		npx github-label-sync --access-token "$(GITHUB_TOKEN)" --labels .github/labels.yml "$$repo"

# ── Individual service targets ────────────────────────────────────────────────

## Start the notification service (services/notification).
## Prints an informational message if the service package does not exist yet.
notification:
	@if [ -d services/notification ]; then \
		pnpm --filter notification dev; \
	else \
		echo "INFO: services/notification does not exist yet — skipping."; \
	fi

## Start the search service (services/search).
## Prints an informational message if the service package does not exist yet.
search:
	@if [ -d services/search ]; then \
		pnpm --filter search dev; \
	else \
		echo "INFO: services/search does not exist yet — skipping."; \
	fi

## Start the media service (services/media).
## Prints an informational message if the service package does not exist yet.
media:
	@if [ -d services/media ]; then \
		pnpm --filter media dev; \
	else \
		echo "INFO: services/media does not exist yet — skipping."; \
	fi

# ── Aggregate service targets ─────────────────────────────────────────────────

## Start all services concurrently:
##   indexer, dm-relay, analytics-oracle, notification, search, media
## Services whose package directory does not yet exist are skipped with a notice.
services:
	@pnpm --filter indexer dev & \
	pnpm --filter dm-relay dev & \
	pnpm --filter analytics-oracle dev & \
	{ [ -d services/notification ] && pnpm --filter notification dev || echo "INFO: services/notification does not exist yet — skipping."; } & \
	{ [ -d services/search ]       && pnpm --filter search dev       || echo "INFO: services/search does not exist yet — skipping."; } & \
	{ [ -d services/media ]        && pnpm --filter media dev        || echo "INFO: services/media does not exist yet — skipping."; } & \
	wait

## Run test suites for all services.
## Services whose package directory does not yet exist are skipped with a notice.
test-services:
	@pnpm --filter indexer test; \
	pnpm --filter dm-relay test; \
	pnpm --filter analytics-oracle test; \
	if [ -d services/notification ]; then \
		pnpm --filter notification test; \
	else \
		echo "INFO: services/notification does not exist yet — skipping tests."; \
	fi; \
	if [ -d services/search ]; then \
		pnpm --filter search test; \
	else \
		echo "INFO: services/search does not exist yet — skipping tests."; \
	fi; \
	if [ -d services/media ]; then \
		pnpm --filter media test; \
	else \
		echo "INFO: services/media does not exist yet — skipping tests."; \
	fi
