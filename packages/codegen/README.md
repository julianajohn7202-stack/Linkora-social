# Generated contract client field guide

The [Linkora Rust contract](../contracts/contracts/linkora-contracts/src/lib.rs) defines the public interface. Cargo compiles it into WASM with an embedded Soroban contract spec. [generate.ts](./generate.ts) reads `packages/contracts/contracts/linkora-contracts/linkora_contracts.wasm` and runs `stellar contract inspect --output xdr-base64-array` on it. The generator decodes those XDR entries with the Stellar SDK and writes TypeScript to [packages/sdk/src/generated](../sdk/src/generated). It hashes the trimmed spec output with SHA-256 for the generated schema fingerprint.

## Regenerate from a clean checkout

Use Node 20 (see [the version pin](../../.node-version)), pnpm 9.15.9, Rust stable with the `wasm32v1-none` target, and Stellar CLI 27.1.0 on your PATH. The [SDK workflow](../../.github/workflows/sdk-e2e.yml) uses that Stellar CLI version. You can install it with `cargo install --locked stellar-cli --version 27.1.0`.

From the repository root:

```sh
pnpm install --frozen-lockfile
rustup target add wasm32v1-none
stellar --version

(
  set -e
  cd packages/contracts
  cargo build --target wasm32v1-none --release -p linkora-contracts
  cp target/wasm32v1-none/release/linkora_contracts.wasm \
    contracts/linkora-contracts/linkora_contracts.wasm
)
pnpm --filter @linkora/codegen generate
git diff -- packages/contracts/contracts/linkora-contracts/linkora_contracts.wasm \
  packages/sdk/src/generated
```

The explicit build and copy follow [contract CI](../../.github/workflows/ci.yml). The root `pnpm codegen` script also invokes the contract build, but Cargo writes under `target/` and the generator reads the checked-in WASM path. Refresh that path after changing Rust or you can accidentally regenerate from the old spec. Check for the generator's completion message because the script skips spec generation when Stellar CLI is missing.

## Review the ABI and generated files

- Review the Rust change first. Commit the refreshed tracked WASM and regenerated files alongside an ABI change.
- In `client.ts`, compare method names, parameter order, ScVal encoders and return types. The generator simulates read methods based on the name and return type, with explicit overrides for some writes. Write methods build unsigned transaction envelopes.
- Expect `types.ts` to reflect supported contract structs and enums, and `events.ts` to reflect supported event spec entries. `index.ts` re-exports the generated modules.
- Expect `schema.hash` and the constant in `schema.ts` to change together when the inspected spec changes. A Rust implementation-only change can change the WASM while leaving the schema and TypeScript intact.
- After staging the expected outputs, run `pnpm codegen:check` and inspect `git diff --exit-code` for regeneration drift. Make source or generator corrections and regenerate if the output differs.

### Example of a public method change

Suppose a future change widens `LinkoraContract::get_report_count(env: Env, post_id: u64)` from `u32` to `u64`. The spec still declares one public argument, `post_id`, because Soroban supplies `Env`. The return type widens from TypeScript `number` to `bigint`. The relevant generated `client.ts` diff would be:

```diff
-  async getReportCount(post_id: bigint): Promise<number> {
+  async getReportCount(post_id: bigint): Promise<bigint> {
     const retval = await this.simulateCall("get_report_count", scvU64(post_id));
-    if (!retval) return 0;
-    return scValToNative(retval) as number;
+    if (!retval) return 0n;
+    return scValToNative(retval) as bigint;
   }
```

The method name and argument encoding stay the same. Both schema fingerprint files should change, and callers that do arithmetic or JSON serialization with the count need to handle `bigint`.
