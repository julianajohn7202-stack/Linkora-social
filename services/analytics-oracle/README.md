# Analytics oracle local fixture

This example starts at the aggregation boundary with a fixed creator metric payload, uses the service's CBOR encoder and Ed25519 signer, and verifies the signature with the Stellar SDK. The fixture runs offline with Node 20 and the workspace dependencies. Its fixed signing seed is for development only.

## Encode, sign, and verify

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @linkora/analytics-oracle build
cd services/analytics-oracle
export SECRETS=env:ORACLE_PRIVATE_KEY_HEX
export ORACLE_PRIVATE_KEY_HEX="$(printf '01%.0s' {1..32})"
node --input-type=module <<'JS'
import { createHash } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { encodeReport } from "./dist/codec.js";
import { Signer } from "./dist/signer.js";

const metrics = {
  creatorAddress: Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey(),
  totalTips: 25000000n,
  postCount: 3n,
  followerDelta: 2n,
  uniqueTippers: 2,
};
const report = {
  version: 1,
  creator: Keypair.fromPublicKey(metrics.creatorAddress).rawPublicKey(),
  windowStart: 1000n,
  windowEnd: 1100n,
  totalTips: metrics.totalTips,
  postCount: metrics.postCount,
  followerDelta: metrics.followerDelta,
  uniqueTippers: metrics.uniqueTippers,
};

const signer = new Signer(Buffer.from(process.env.ORACLE_PRIVATE_KEY_HEX, "hex"));
const reportCbor = encodeReport(report);
const { reportHash, signature } = signer.signReport(reportCbor);
const oraclePublicKey = signer.stellarPublicKey();
signer.dispose();

const payload = {
  oracleName: "local",
  reportHash: reportHash.toString("hex"),
  reportCbor: reportCbor.toString("hex"),
  signature: signature.toString("hex"),
  txHash: null,
  submittedAt: null,
  report: {
    ...report,
    creator: Buffer.from(report.creator).toString("hex"),
    windowStart: report.windowStart.toString(),
    windowEnd: report.windowEnd.toString(),
    totalTips: report.totalTips.toString(),
    postCount: report.postCount.toString(),
    followerDelta: report.followerDelta.toString(),
  },
};

const digest = createHash("sha256").update(Buffer.from(payload.reportCbor, "hex")).digest();
const verified =
  digest.toString("hex") === payload.reportHash &&
  Keypair.fromPublicKey(oraclePublicKey).verify(digest, Buffer.from(payload.signature, "hex"));
if (!verified) throw new Error("Attestation signature verification failed");
console.log(JSON.stringify({ creatorAddress: metrics.creatorAddress, oraclePublicKey, verified, payload }, null, 2));
JS
```

The final JSON includes `creatorAddress` for the HTTP lookup, `oraclePublicKey` for verification, and `verified: true`. The payload below abbreviates the generated hex strings.

```json
{
  "oracleName": "local",
  "reportHash": "<32-byte SHA-256 digest in hex>",
  "reportCbor": "<CBOR report in hex>",
  "signature": "<64-byte Ed25519 signature in hex>",
  "txHash": null,
  "submittedAt": null,
  "report": {
    "version": 1,
    "creator": "<32-byte creator public key in hex>",
    "windowStart": "1000",
    "windowEnd": "1100",
    "totalTips": "25000000",
    "postCount": "3",
    "followerDelta": "2",
    "uniqueTippers": 2
  }
}
```

The signature covers the SHA-256 digest of the CBOR bytes. Consumers should verify against the expected oracle public key and decode the verified CBOR for authenticated metrics. The companion JSON encodes large integers as decimal strings, and `totalTips` is measured in stroops.

## Run the local HTTP service

For a live response, start PostgreSQL with the [indexer migrations](../indexer/migrations/README.md) applied and populate creator activity in the ledger window being processed. Run a local Soroban RPC with an initialized Linkora contract. Fund the development signer account and register its public key in the contract under `local`. The offline example prints both the signer key and a sample creator address. Redis is optional in development.

In the same service directory and shell as the signing example, set the values for your local services:

```sh
export NODE_ENV=development
export DATABASE_URL='postgresql://linkora:linkora@127.0.0.1:5432/linkora_indexer'
export SOROBAN_RPC_URL='http://127.0.0.1:8000/soroban/rpc'
export NETWORK_PASSPHRASE='Standalone Network ; February 2017'
export CONTRACT_ID='<local Linkora contract address>'
export ORACLE_NAME=local WINDOW_LEDGERS=100 PORT=4000
node dist/index.js
```

Use the actual RPC network passphrase and database credentials. In another shell, after a successful submission for your indexed creator:

```sh
curl -fsS http://localhost:4000/health/ready
CREATOR_ADDRESS='<indexed creator Stellar G-address>'
curl -fsS "http://localhost:4000/attestations/${CREATOR_ADDRESS}"
```

The live payload has the same fields as the fixture's `payload`, with a transaction hash and a Unix millisecond submission timestamp. The endpoint returns 404 while the creator has no current cached attestation. See the [oracle reference](../../docs/indexer/ANALYTICS_ORACLE.md) for polling, cache behavior, and additional variables.
