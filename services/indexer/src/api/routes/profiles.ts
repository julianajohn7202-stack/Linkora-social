import { Account, Contract, Networks, StrKey, TransactionBuilder, rpc, scValToNative } from "@stellar/stellar-sdk";
import { Router, Request, Response } from "express";
import { Database } from "../../db";
import { validateParams, validateQuery } from "../../middleware/validate";
import { z } from "zod";
import { stellarAddressSchema } from "@linkora/types/src/schemas";
import { notFoundError } from "@linkora/types/src/errors";
import { profileCacheKey, QueryCache } from "../../cache";

const getProfileParamsSchema = z.object({
  address: stellarAddressSchema,
});
const searchProfileQuerySchema = z.object({
  username: z.string().trim().min(1).max(64).optional(),
  q: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).refine(
  (query) => Boolean(query.username) !== Boolean(query.q),
  "provide exactly one of username or q"
);

export function createProfilesRouter(db: Database, cache?: QueryCache): Router {
  const router = Router();

  router.get(
    "/:address/reputation",
    validateParams(getProfileParamsSchema),
    async (req: Request, res: Response): Promise<void> => {
      const address = String(req.params.address);
      if (!db.getReputationScore) {
        res.status(501).json({ error: "Reputation scores are not available" });
        return;
      }

      const reputation = await db.getReputationScore(address);
      if (!reputation) {
        res.status(404).json({ error: "Reputation score not found" });
        return;
      }
      res.json(reputation);
    }
  );

  router.get(
    "/:address/creator-token",
    validateParams(getProfileParamsSchema),
    async (req: Request, res: Response): Promise<void> => {
      const address = String(req.params.address);
      const profile = await db.getProfile(address);
      const token = profile?.creator_token;
      if (!token || !StrKey.isValidContract(token)) {
        res.sendStatus(404);
        return;
      }

      const rpcUrl = process.env.STELLAR_RPC_URL;
      if (!rpcUrl) {
        res.sendStatus(503);
        return;
      }

      const metadata = await cache?.getOrLoad(`creator-token:${token}`, 60, loadMetadata) ??
        await loadMetadata();
      res.json({ token, info: metadata });

      async function loadMetadata() {
        const server = new rpc.Server(rpcUrl!, { allowHttp: new URL(rpcUrl!).protocol === "http:" });
        const contract = new Contract(token!);
        async function read(method: string): Promise<unknown> {
          const tx = new TransactionBuilder(new Account(address, "0"), {
            fee: "100",
            networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET,
          }).addOperation(contract.call(method)).setTimeout(30).build();
          const response = await server.simulateTransaction(tx);
          if (!rpc.Api.isSimulationSuccess(response) || !response.result) {
            throw new Error(`Unable to read creator token ${method}`);
          }
          return scValToNative(response.result.retval);
        }
        const [name, symbol, decimals] = await Promise.all([read("name"), read("symbol"), read("decimals")]);
        return { name: String(name), symbol: String(symbol), decimals: Number(decimals) };
      }
    }
  );

  router.get(
    "/:address",
    validateParams(getProfileParamsSchema),
    async (req: Request, res: Response): Promise<void> => {
      const addressParam = req.params.address;
      const address = Array.isArray(addressParam) ? (addressParam[0] ?? "") : addressParam;

      const profile = cache
        ? await cache.getOrLoad(profileCacheKey(address), 60, () => db.getProfile(address))
        : await db.getProfile(address);
      if (!profile) {
        const err = notFoundError("Profile not found");
        res.status(err.statusCode).json(err.toJSON(req.context?.requestId));
        return;
      }

      res.json(profile);
    }
  );

  return router;
}
