// tracing MUST be the very first import so OTel auto-instrumentations are
// registered before express (or any other library) is loaded.
import "./tracing";

import express, { type Application, Request, Response } from "express";
import { trace } from "@opentelemetry/api";
import { pino } from "pino";
import { randomUUID } from "node:crypto";
import { dispatch, type NotificationPayload } from "./dispatcher";
import { setUserPreferences, type UserNotificationPreferences } from "./preferences";

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

function isNotificationPayload(value: unknown): value is Omit<NotificationPayload, "id" | "createdAt"> {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.recipient === "string" && payload.recipient.trim().length > 0 &&
    ["follow", "tip", "like", "mention", "dm"].includes(String(payload.type)) &&
    typeof payload.title === "string" && payload.title.trim().length > 0 &&
    typeof payload.body === "string" && payload.body.trim().length > 0 &&
    (payload.data === undefined || (typeof payload.data === "object" && payload.data !== null && !Array.isArray(payload.data)))
  );
}

/** Internal service endpoint. Set NOTIFICATION_API_TOKEN to require bearer auth. */
app.post("/notify", async (req: Request, res: Response) => {
  const expectedToken = process.env["NOTIFICATION_API_TOKEN"];
  if (expectedToken && req.get("authorization") !== `Bearer ${expectedToken}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  if (!isNotificationPayload(req.body)) {
    res.status(400).json({ error: "invalid notification payload" });
    return;
  }

  const payload: NotificationPayload = {
    ...req.body,
    recipient: req.body.recipient.trim(),
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  try {
    const results = await dispatch(payload, {
      async send(channel, notification) {
        // The test-only switch exercises channel isolation without contacting a
        // real push provider. Production dispatchers supply their provider here.
        if (process.env["NODE_ENV"] === "test" && channel === "push" && req.body.testFailPush === true) {
          throw new Error("Simulated push failure");
        }
        logger.info({ channel, notificationId: notification.id, recipient: notification.recipient }, "notification dispatched");
      },
    });
    res.status(202).json({ notification: payload, results });
  } catch (error) {
    logger.error({ error }, "notification dispatch failed");
    res.status(500).json({ error: "notification dispatch failed" });
  }
});

/** Update delivery preferences for a recipient. */
app.put("/preferences/:userAddress", async (req: Request, res: Response) => {
  const expectedToken = process.env["NOTIFICATION_API_TOKEN"];
  if (expectedToken && req.get("authorization") !== `Bearer ${expectedToken}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const { push, email, inApp } = req.body ?? {};
  if (typeof push !== "boolean" || typeof email !== "boolean" || typeof inApp !== "boolean") {
    res.status(400).json({ error: "push, email, and inApp must be booleans" });
    return;
  }
  const preferences: UserNotificationPreferences = {
    userAddress: req.params.userAddress,
    channels: { push, email, inApp },
  };
  await setUserPreferences(preferences);
  res.status(200).json({ preferences });
});

const tracer = trace.getTracer("notification");

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

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, "notification service listening");
});

// Graceful shutdown
function shutdown() {
  logger.info("shutting down notification service");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export { app };
