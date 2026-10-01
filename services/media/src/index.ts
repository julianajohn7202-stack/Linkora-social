// tracing MUST be the very first import so OTel auto-instrumentations are
// registered before express (or any other library) is loaded.
import "./tracing";

import express, { Request, Response } from "express";
import { trace } from "@opentelemetry/sdk-node";
import { pino } from "pino";

const logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  base: { service: "media" },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(process.env["NODE_ENV"] !== "production" && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, ignore: "pid,hostname", translateTime: "SYS:standard" },
    },
  }),
});

const app = express();
app.use(express.json());

const tracer = trace.getTracer("media");

/** GET /health — liveness probe with a sample manual span */
app.get("/health", (_req: Request, res: Response) => {
  const span = tracer.startSpan("media.health.check");
  try {
    res.json({ status: "ok", service: "media" });
  } finally {
    span.end();
  }
});

/** GET /health/ready — readiness probe */
app.get("/health/ready", (_req: Request, res: Response) => {
  res.json({ status: "ready", service: "media" });
});

const PORT = parseInt(process.env["PORT"] ?? "3004", 10);

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, "media service listening");
});

// Graceful shutdown
function shutdown() {
  logger.info("shutting down media service");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export { app };
