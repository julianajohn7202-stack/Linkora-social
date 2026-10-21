import { Router, Request, Response } from "express";
import { Database } from "../../db";
import { validateParams, validateQuery } from "../../middleware/validate";
import { z } from "zod";
import { stellarAddressSchema } from "@linkora/types/src/schemas";
import { notFoundError } from "@linkora/types/src/errors";

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

export function createProfilesRouter(db: Database): Router {
  const router = Router();

  router.get(
    "/search",
    validateQuery(searchProfileQuerySchema),
    async (req: Request, res: Response): Promise<void> => {
      const { username, q, limit } = req.query as unknown as z.infer<typeof searchProfileQuerySchema>;
      if (username) {
        const profile = await db.getProfileByUsername(username);
        res.json({ address: profile?.address ?? null });
        return;
      }
      const profiles = await db.searchProfiles(q!, limit);
      res.json({ profiles });
    }
  );

  router.get(
    "/:address",
    validateParams(getProfileParamsSchema),
    async (req: Request, res: Response): Promise<void> => {
      const { address } = req.params;

      const profile = await db.getProfile(address);
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
