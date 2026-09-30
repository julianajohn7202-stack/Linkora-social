.PHONY: dev build lint test format labels db-backup db-restore

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

# Sync GitHub issue/PR labels from .github/labels.yml to the repository.
# Requires the GITHUB_TOKEN env var (a token with repo scope). The target
# repository is derived from the `origin` git remote.
labels:
	@test -n "$(GITHUB_TOKEN)" || { echo "GITHUB_TOKEN is not set"; exit 1; }
	@repo=$$(git remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$$##'); \
		npx github-label-sync --access-token "$(GITHUB_TOKEN)" --labels .github/labels.yml "$$repo"

# ── Database backup / restore (local dev only) ────────────────────────────────
#
# Usage:
#   make db-backup                    — creates a timestamped dump in ./backups/
#   make db-restore file=<dump-path>  — restores the database from a dump file
#
# Prerequisites: Docker Compose stack must be running (`make dev` or
#   `docker compose up -d postgres`).  The dump is created inside the
#   running postgres container so no local pg_dump installation is needed.
#
# Credentials are read from the same environment variables that docker-compose
# uses: POSTGRES_USER (default: linkora), POSTGRES_PASSWORD (default: linkora),
# POSTGRES_DB (default: linkora).

BACKUP_DIR := backups
POSTGRES_USER ?= linkora
POSTGRES_PASSWORD ?= linkora
POSTGRES_DB ?= linkora
TIMESTAMP := $(shell date +%Y%m%d_%H%M%S)
BACKUP_FILE := $(BACKUP_DIR)/$(POSTGRES_DB)_$(TIMESTAMP).dump

db-backup:
	@mkdir -p $(BACKUP_DIR)
	@echo "→ Creating PostgreSQL dump: $(BACKUP_FILE)"
	@docker compose exec -e PGPASSWORD=$(POSTGRES_PASSWORD) postgres \
		pg_dump -U $(POSTGRES_USER) -F c $(POSTGRES_DB) > $(BACKUP_FILE)
	@echo "✓ Backup saved to $(BACKUP_FILE)"

db-restore:
	@test -n "$(file)" || { echo "Usage: make db-restore file=<path-to-dump>"; exit 1; }
	@test -f "$(file)" || { echo "Error: dump file '$(file)' not found"; exit 1; }
	@echo "→ Restoring PostgreSQL database from: $(file)"
	@docker compose exec -e PGPASSWORD=$(POSTGRES_PASSWORD) -T postgres \
		pg_restore -U $(POSTGRES_USER) -d $(POSTGRES_DB) --clean --if-exists < $(file)
	@echo "✓ Database restored from $(file)"
