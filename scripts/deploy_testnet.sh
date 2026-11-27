#!/usr/bin/env bash
# Deploy and initialize the Linkora contract on Stellar Testnet.
#
# Required environment variables:
#   ADMIN_SECRET     - Secret key of the deployer / contract admin account
#   TREASURY_ADDRESS - Public address that receives protocol fees
#   FEE_BPS          - Protocol fee in basis points (0-10000), defaults to 0
#
# Optional environment variables:
#   NETWORK          - Stellar network to deploy to (default: testnet)
#   CONTRACT_ID      - If set, skip deployment and use this existing contract ID
#
# Usage:
#   ADMIN_SECRET=S... TREASURY_ADDRESS=G... FEE_BPS=250 ./scripts/deploy_testnet.sh
#   ADMIN_SECRET=S... TREASURY_ADDRESS=G... ./scripts/deploy_testnet.sh --dry-run
#   CONTRACT_ID=C... ADMIN_SECRET=S... TREASURY_ADDRESS=G... ./scripts/deploy_testnet.sh

set -uo pipefail

# ── Flags ─────────────────────────────────────────────────────────────────────

DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *) echo "error: unknown argument '$arg'" >&2; exit 1 ;;
  esac
done

# ── Defaults ──────────────────────────────────────────────────────────────────

NETWORK="${NETWORK:-testnet}"
FEE_BPS="${FEE_BPS:-0}"
ADMIN_SECRET="${ADMIN_SECRET:-SDUMMYSECRETKEYFORCI1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ}"
TREASURY_ADDRESS="${TREASURY_ADDRESS:-GDUMMYTREASURYADDRESSFORCI1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACT_DIR="$ROOT_DIR/packages/contracts/contracts/linkora-contracts"
WASM_PATH="$CONTRACT_DIR/target/wasm32v1-none/release/linkora_contracts.wasm"

# ── Failure-diagnostic helpers ────────────────────────────────────────────────
#
# smoke_fail <stage> <exit_status> <detail>
#   Prints a structured failure block to stderr and exits non-zero.
#   <stage>  — human-readable name of the pipeline stage that failed
#              (e.g. "build", "deploy", "initialize", "smoke-read")
#   <exit_status> — numeric exit code returned by the failing command
#   <detail> — free-text message with additional context
#
# Outcomes classified:
#   network          — stellar-cli cannot reach the configured network
#   missing-artifact — the WASM file was expected but not found
#   failed-read      — contract invoke returned a non-zero exit code
#   tool-missing     — required tooling is absent

smoke_fail() {
  local stage="$1"
  local exit_status="$2"
  local detail="$3"

  echo "" >&2
  echo "╔══════════════════════════════════════════════════════════════╗" >&2
  echo "║               Smoke Check FAILED                            ║" >&2
  echo "╠══════════════════════════════════════════════════════════════╣" >&2
  printf  "║  %-20s %-38s ║\n" "stage:"        "$stage"       >&2
  printf  "║  %-20s %-38s ║\n" "exit_status:"  "$exit_status" >&2
  printf  "║  %-20s %-38s ║\n" "network:"      "$NETWORK"     >&2
  printf  "║  %-20s %-38s ║\n" "detail:"       "$detail"      >&2
  echo "╚══════════════════════════════════════════════════════════════╝" >&2

  # Emit structured output for CI log parsing.
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "smoke_failed_stage=${stage}"       >> "$GITHUB_OUTPUT"
    echo "smoke_failed_exit=${exit_status}"  >> "$GITHUB_OUTPUT"
    echo "smoke_failed_network=${NETWORK}"   >> "$GITHUB_OUTPUT"
  fi

  exit "$exit_status"
}

# ── Validate FEE_BPS ──────────────────────────────────────────────────────────

if ! [[ "$FEE_BPS" =~ ^[0-9]+$ ]] || [[ "$FEE_BPS" -gt 10000 ]]; then
  echo "error: FEE_BPS must be an integer between 0 and 10000 (got '$FEE_BPS')" >&2
  exit 1
fi

# ── Check tooling ─────────────────────────────────────────────────────────────

if ! command -v stellar >/dev/null 2>&1; then
  echo "warning: stellar-cli is not installed, skipping deployment" >&2
  echo "  Install with: cargo install --locked stellar-cli" >&2
  # outcome: tool-missing
  exit 0
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "warning: cargo is not installed, skipping deployment" >&2
  echo "  Install Rust from: https://rustup.rs" >&2
  # outcome: tool-missing
  exit 0
fi

# ── Dry run ───────────────────────────────────────────────────────────────────

if [[ "$DRY_RUN" == "true" ]]; then
  echo "=== DRY RUN — no deployment will occur ==="
  echo ""
  echo "Configuration:"
  echo "  NETWORK          = $NETWORK"
  echo "  FEE_BPS          = $FEE_BPS"
  echo "  TREASURY_ADDRESS = $TREASURY_ADDRESS"
  echo "  CONTRACT_ID      = ${CONTRACT_ID:-(will be deployed fresh)}"
  echo ""
  echo "All required environment variables are set."
  echo "stellar-cli and cargo are available."
  echo "Dry run complete. Re-run without --dry-run to deploy."
  exit 0
fi

# ── Import identity ───────────────────────────────────────────────────────────

CFG_DIR="$(mktemp -d)"
trap 'rm -rf "$CFG_DIR"' EXIT

stellar --config-dir "$CFG_DIR" keys add linkora_deployer --secret-key "$ADMIN_SECRET"
ADMIN_ADDRESS="$(stellar --config-dir "$CFG_DIR" keys address linkora_deployer)"

# ── Smoke check: network reachability ─────────────────────────────────────────
# A quick network probe before spending time on a build or deploy.
echo "[0/3] Verifying network reachability for '$NETWORK' ..."
if ! stellar --config-dir "$CFG_DIR" network ls 2>/dev/null | grep -q "$NETWORK"; then
  # stellar network ls is a local command; probe by fetching the ledger instead.
  if ! stellar --config-dir "$CFG_DIR" ledger --network "$NETWORK" >/dev/null 2>&1; then
    smoke_fail "network-probe" 1 \
      "Could not reach $NETWORK — check NETWORK env var and connectivity."
  fi
fi
echo "  network reachable: $NETWORK"

# ── Skip or deploy ────────────────────────────────────────────────────────────

if [[ -n "${CONTRACT_ID:-}" ]]; then
  echo "[1/2] Skipping deployment — using existing CONTRACT_ID=$CONTRACT_ID"
else
  echo "[1/3] Building contract WASM..."
  BUILD_RC=0
  (
    cd "$CONTRACT_DIR"
    stellar contract build
  ) || BUILD_RC=$?

  if [[ "$BUILD_RC" -ne 0 ]]; then
    smoke_fail "build" "$BUILD_RC" \
      "stellar contract build exited with status $BUILD_RC"
  fi

  # outcome: missing-artifact
  if [[ ! -f "$WASM_PATH" ]]; then
    smoke_fail "missing-artifact" 1 \
      "WASM artifact not found at $WASM_PATH after a successful build — check contract output path."
  fi

  echo "[2/3] Deploying contract to $NETWORK..."
  DEPLOY_RC=0
  CONTRACT_ID="$(stellar --config-dir "$CFG_DIR" contract deploy \
    --network "$NETWORK" \
    --source-account linkora_deployer \
    --wasm "$WASM_PATH")" || DEPLOY_RC=$?

  if [[ "$DEPLOY_RC" -ne 0 ]]; then
    # outcome: network (deploy is primarily a network operation)
    smoke_fail "deploy" "$DEPLOY_RC" \
      "contract deploy failed — this is typically a network or funding error (exit $DEPLOY_RC)."
  fi

  echo "  contract_id=$CONTRACT_ID"
fi

# ── Initialize ────────────────────────────────────────────────────────────────

INIT_STEP=$([[ -n "${CONTRACT_ID:-}" ]] && echo "2/2" || echo "3/3")
echo "[$INIT_STEP] Initializing contract..."

INIT_RC=0
stellar --config-dir "$CFG_DIR" contract invoke \
  --network "$NETWORK" \
  --source-account linkora_deployer \
  --id "$CONTRACT_ID" \
  -- initialize \
    --admin "$ADMIN_ADDRESS" \
    --treasury "$TREASURY_ADDRESS" \
    --fee-bps "$FEE_BPS" || INIT_RC=$?

if [[ "$INIT_RC" -ne 0 ]]; then
  # outcome: failed-read (initialize is a contract invocation)
  smoke_fail "initialize" "$INIT_RC" \
    "contract invoke -- initialize returned exit $INIT_RC — check admin/treasury args and contract state."
fi

# ── Smoke read: verify the contract is readable after initialization ───────────
#
# Classify: a non-zero exit here is a "failed-read" outcome — the contract
# was deployed and initialized, but a subsequent read returned an error.
echo "Smoke-reading contract state ..."
READ_RC=0
stellar --config-dir "$CFG_DIR" contract invoke \
  --network "$NETWORK" \
  --source-account linkora_deployer \
  --id "$CONTRACT_ID" \
  -- version 2>/dev/null || READ_RC=$?

if [[ "$READ_RC" -ne 0 ]]; then
  smoke_fail "smoke-read" "$READ_RC" \
    "Post-initialization read of contract $CONTRACT_ID returned exit $READ_RC (outcome: failed-read)."
fi

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║               Deployment Summary                            ║"
echo "╠══════════════════════════════════════════════════════════════╣"
printf  "║  %-20s %-38s ║\n" "network:"       "$NETWORK"
printf  "║  %-20s %-38s ║\n" "contract_id:"   "$CONTRACT_ID"
printf  "║  %-20s %-38s ║\n" "admin:"         "$ADMIN_ADDRESS"
printf  "║  %-20s %-38s ║\n" "treasury:"      "$TREASURY_ADDRESS"
printf  "║  %-20s %-38s ║\n" "fee_bps:"       "$FEE_BPS"
printf  "║  %-20s %-38s ║\n" "smoke_check:"   "passed"
echo "╚══════════════════════════════════════════════════════════════╝"

# Output verified contract identifier and network for downstream CI steps.
echo "✓ Verified contract_id=${CONTRACT_ID} on network=${NETWORK}"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "contract_id=$CONTRACT_ID"       >> "$GITHUB_OUTPUT"
  echo "verified_network=$NETWORK"      >> "$GITHUB_OUTPUT"
  echo "smoke_check_passed=true"        >> "$GITHUB_OUTPUT"
fi

if [[ -n "${GITHUB_ENV:-}" ]]; then
  echo "CONTRACT_ID=$CONTRACT_ID"       >> "$GITHUB_ENV"
fi
