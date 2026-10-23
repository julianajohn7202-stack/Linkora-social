import http from "http";
import type { AddressInfo } from "net";
import express from "express";
import { createRateLimiters } from "../middleware/rateLimit";

interface RateLimitInfo {
  totalHits: number;
  resetTime: Date;
}

class FakeRedisRateLimitStore {
  private counters = new Map<string, RateLimitInfo>();
  private windowMs = 60_000;

  init(options: { windowMs: number }): void {
    this.windowMs = options.windowMs;
  }

  async get(key: string): Promise<RateLimitInfo | undefined> {
    return this.counters.get(key);
  }

  async increment(key: string): Promise<RateLimitInfo> {
    const now = Date.now();
    const entry = this.counters.get(key);
    if (!entry || now >= entry.resetTime.getTime()) {
      const next = { totalHits: 1, resetTime: new Date(now + this.windowMs) };
      this.counters.set(key, next);
      return next;
    }
    entry.totalHits += 1;
    return entry;
  }

  async decrement(key: string): Promise<void> {
    const entry = this.counters.get(key);
    if (entry) entry.totalHits = Math.max(0, entry.totalHits - 1);
  }

  async resetKey(key: string): Promise<void> {
    this.counters.delete(key);
  }
}

function request(server: http.Server): Promise<{ status: number; retryAfter?: string }> {
  const address = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${address.port}/api/messages`, (res) => {
      res.resume();
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, retryAfter: res.headers["retry-after"] })
      );
    });
    req.on("error", reject);
  });
}

describe("DM relay HTTP rate limiting", () => {
  let server: http.Server;
  let store: FakeRedisRateLimitStore;

  beforeEach(() => {
    store = new FakeRedisRateLimitStore();
    const app = express();
    const { anonLimiter } = createRateLimiters(store);
    app.get("/api/messages", anonLimiter, (_req, res) => res.sendStatus(200));
    server = app.listen(0);
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    jest.restoreAllMocks();
  });

  it("allows 60 messages and returns 429 with Retry-After for the 61st", async () => {
    for (let message = 0; message < 60; message++) {
      expect((await request(server)).status).toBe(200);
    }

    const rejected = await request(server);
    expect(rejected.status).toBe(429);
    expect(rejected.retryAfter).toBeDefined();
    expect(Number(rejected.retryAfter)).toBeGreaterThan(0);
  });

  it("resets the limit after the window expires", async () => {
    const now = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(now);

    for (let message = 0; message < 60; message++) {
      expect((await request(server)).status).toBe(200);
    }
    expect((await request(server)).status).toBe(429);

    jest.spyOn(Date, "now").mockReturnValue(now + 60_001);
    expect((await request(server)).status).toBe(200);
  });
});
