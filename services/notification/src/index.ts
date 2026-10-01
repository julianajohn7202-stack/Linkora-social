import express, { Request, Response } from "express";
import helmet from "helmet";
import { Pool } from "pg";
import { Redis } from "ioredis";

const PORT = parseInt(process.env.PORT ?? "3004", 10);
const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;

const app = express();
app.use(helmet());
app.use(express.json());

// PostgreSQL connection pool
const pool = new Pool({ connectionString: DATABASE_URL });

// Redis client for pub/sub fan-out
const redis = new Redis(REDIS_URL ?? "redis://redis:6379", {
  lazyConnect: true,
  enableOfflineQueue: false,
});

// ── Health endpoint ────────────────────────────────────────────────────────
app.get("/health", async (_req: Request, res: Response) => {
  try {
    await pool.query("SELECT 1");
    const redisPing = await redis.ping().catch(() => "unreachable");
    res.json({
      status: "ok",
      service: "notification",
      db: "connected",
      redis: redisPing === "PONG" ? "connected" : "unreachable",
    });
  } catch (_err) {
    res.status(503).json({ status: "error", service: "notification" });
  }
});

// ── Start server ───────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[notification] listening on port ${PORT}`);
});

export default app;
