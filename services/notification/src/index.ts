// tracing MUST be the very first import so OTel auto-instrumentations are
// registered before express (or any other library) is loaded.
import "./tracing";

import express, { type Application, Request, Response } from "express";
import { trace } from "@opentelemetry/api";
import { pino } from "pino";
import { Pool } from "pg";
import Redis from "ioredis";
import { notificationQueue, dispatch } from "./dispatcher";
import { preferencesRouter, setDatabasePool } from "./preferences";

// prom-client optional fallback shim if not installed
let client: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  client = require("prom-client");
} catch {
  client = {
    collectDefaultMetrics: () => {},
    Counter: class {
      inc() {}
    },
    Gauge: class {
      set() {}
    },
    Histogram: class {
      observe() {}
    },
    register: { contentType: "text/plain", metrics: async () => "" },
  };
}

const logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  base: { service: "notification" },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(process.env["NODE_ENV"] !== "production" && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, ignore: "pid,hostname", translateTime: "SYS:standard" },
    },
  }),
});

const app: Application = express();
app.use(express.json());

// Mount notification preferences routes (/preferences/:address)
app.use(preferencesRouter);

/** POST /notify — Dispatches notification across enabled channels */
app.post("/notify", async (req: Request, res: Response) => {
  const { recipient, title, body, data, testFailPush } = req.body ?? {};
  if (!recipient || !title || !body) {
    res.status(400).json({ error: "recipient, title, and body are required" });
    return;
  }

  const prevEnv = process.env.NODE_ENV;
  if (testFailPush) {
    process.env.NODE_ENV = "test-fail";
  }

  try {
    const summary = await dispatch(recipient, { title, body, data });
    res.status(202).json({ results: summary.results });
  } finally {
    if (testFailPush) {
      process.env.NODE_ENV = prevEnv;
    }
  }
});

const tracer = trace.getTracer("notification");

// ── Prometheus Metrics ──────────────────────────────────────────────────────
client.collectDefaultMetrics({ prefix: "notification_" });

export const dispatchTotal = new client.Counter({
  name: "dispatch_total",
  help: "Total number of dispatched notifications",
  labelNames: ["channel", "status"],
});

export const dispatchErrors = new client.Counter({
  name: "dispatch_errors_total",
  help: "Total number of dispatch errors",
  labelNames: ["channel"],
});

export const queueDepth = new client.Gauge({
  name: "queue_depth",
  help: "Current depth of the notification queue",
});

export const channelLatency = new client.Histogram({
  name: "channel_latency_seconds",
  help: "Latency of notification dispatch per channel",
  labelNames: ["channel"],
  buckets: [0.1, 0.5, 1, 2, 5],
});

/** GET /metrics — Prometheus metrics endpoint */
app.get("/metrics", async (_req: Request, res: Response) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});
// ────────────────────────────────────────────────────────────────────────────

/** GET /health — liveness probe with a sample manual span */
app.get("/health", (_req: Request, res: Response) => {
  const span = tracer.startSpan("notification.health.check");
  try {
    res.json({ status: "ok", service: "notification" });
  } finally {
    span.end();
  }
});

/** GET /health/ready — readiness probe */
app.get("/health/ready", (_req: Request, res: Response) => {
  res.json({ status: "ready", service: "notification" });
});

const PORT = parseInt(process.env["PORT"] ?? "3002", 10);
const database = process.env["DATABASE_URL"]
  ? new Pool({ connectionString: process.env["DATABASE_URL"] })
  : undefined;

if (database) {
  setDatabasePool(database);
}

const redis = process.env["REDIS_URL"]
  ? new Redis(process.env["REDIS_URL"], { maxRetriesPerRequest: 1, retryStrategy: () => null })
  : undefined;

// Export server reference only if not in test environment or started directly
let server: ReturnType<typeof app.listen> | undefined;
if (process.env["NODE_ENV"] !== "test") {
  server = app.listen(PORT, () => {
    logger.info({ port: PORT }, "notification service listening");
  });
}

// Graceful shutdown
function shutdown() {
  logger.info("shutting down notification service");
  if (server) {
    server.close(() => {
      void notificationQueue
        .stopAndDrain()
        .then(() => process.exit(0))
        .catch((error) => {
          logger.error({ err: error }, "failed to drain notification queue");
          process.exit(1);
        });
    });
  }
  setTimeout(() => process.exit(1), 30_000).unref();
}

process.on("SIGTERM", () => shutdown());
process.on("SIGINT", () => shutdown());

export * from "./preferences";
export { app, server, database, redis };
