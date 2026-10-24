import { Pool } from "pg";
import {
  getUserPreferences,
  setUserPreferences,
  clearPreferencesStore,
  setDatabasePool,
  getPreferencesHandler,
  updatePreferencesHandler,
  SUPPORTED_NOTIFICATION_TYPES,
  defaultPreferences,
  parsePreferencesInput,
  verifyWriteAuth,
  UserNotificationPreferences,
} from "../preferences";

function createMockReqRes(options: {
  params?: Record<string, string>;
  body?: any;
  headers?: Record<string, string>;
}) {
  const headers = options.headers ?? {};
  const req: any = {
    params: options.params ?? {},
    body: options.body ?? {},
    headers,
    header(name: string) {
      const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
      return key ? headers[key] : undefined;
    },
  };

  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    },
  };

  return { req, res };
}

describe("Notification Preferences Engine", () => {
  beforeEach(() => {
    clearPreferencesStore();
    setDatabasePool(undefined);
  });

  describe("In-Memory Store & Defaults", () => {
    it("returns default preferences for a new user address", async () => {
      const address = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
      const prefs = await getUserPreferences(address);

      expect(prefs.userAddress).toBe(address);
      expect(prefs.address).toBe(address);
      expect(prefs.channels).toEqual({
        push: true,
        email: false,
        inApp: true,
      });
      expect(prefs.push_enabled).toBe(true);
      expect(prefs.email_enabled).toBe(false);
      expect(prefs.inapp_enabled).toBe(true);

      for (const type of SUPPORTED_NOTIFICATION_TYPES) {
        expect(prefs.types![type]).toEqual({
          push_enabled: true,
          email_enabled: false,
          inapp_enabled: true,
        });
      }
    });

    it("saves and retrieves updated preferences in memory", async () => {
      const address = "GBTESTADDRESS123456789";
      const initial = await getUserPreferences(address);

      const updated = parsePreferencesInput(initial, {
        push_enabled: false,
        email_enabled: true,
        types: {
          new_followers: {
            push_enabled: false,
            email_enabled: true,
            inapp_enabled: false,
          },
        },
      });

      await setUserPreferences(updated);

      const retrieved = await getUserPreferences(address);
      expect(retrieved.push_enabled).toBe(false);
      expect(retrieved.email_enabled).toBe(true);
      expect(retrieved.inapp_enabled).toBe(true);
      expect(retrieved.channels.push).toBe(false);
      expect(retrieved.channels.email).toBe(true);
      expect(retrieved.channels.inApp).toBe(true);
      expect(retrieved.types!["new_followers"]).toEqual({
        push_enabled: false,
        email_enabled: true,
        inapp_enabled: false,
      });
    });

    it("handles legacy channels object updates", async () => {
      const address = "GBTESTADDRESS_CHANNELS";
      const initial = await getUserPreferences(address);

      const updated = parsePreferencesInput(initial, {
        channels: {
          push: false,
          email: false,
          inApp: true,
        },
      });

      await setUserPreferences(updated);

      const retrieved = await getUserPreferences(address);
      expect(retrieved.channels.push).toBe(false);
      expect(retrieved.channels.email).toBe(false);
      expect(retrieved.channels.inApp).toBe(true);
      expect(retrieved.push_enabled).toBe(false);
    });
  });

  describe("Database Persistence (Mocked Pool)", () => {
    it("queries notification_preferences table when database pool is set", async () => {
      const address = "GBDBTESTADDRESS1";
      const mockQuery = jest.fn().mockImplementation((sql: string) => {
        if (sql.includes("CREATE TABLE") || sql.includes("ALTER TABLE")) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes("SELECT * FROM notification_preferences")) {
          return Promise.resolve({
            rows: [
              {
                address,
                browser_push_enabled: true,
                new_followers: true,
                new_likes: false,
                new_comments: true,
                direct_messages: false,
                pool_activity: true,
                governance_updates: true,
                push_enabled: true,
                email_enabled: true,
                inapp_enabled: false,
                preferences: {
                  new_followers: { push_enabled: true, email_enabled: true, inapp_enabled: false },
                },
                updated_at: new Date().toISOString(),
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const mockPool = { query: mockQuery } as unknown as Pool;
      setDatabasePool(mockPool);

      const prefs = await getUserPreferences(address);
      expect(prefs.userAddress).toBe(address);
      expect(prefs.push_enabled).toBe(true);
      expect(prefs.email_enabled).toBe(true);
      expect(prefs.inapp_enabled).toBe(false);
      expect(prefs.types!["new_followers"]).toEqual({
        push_enabled: true,
        email_enabled: true,
        inapp_enabled: false,
      });
      expect(prefs.types!["new_likes"]).toEqual({
        push_enabled: false,
        email_enabled: false,
        inapp_enabled: false,
      });
    });

    it("executes upsert on notification_preferences table on setUserPreferences", async () => {
      const address = "GBDBTESTADDRESS2";
      const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
      const mockPool = { query: mockQuery } as unknown as Pool;
      setDatabasePool(mockPool);

      const current = await getUserPreferences(address);
      const updated = parsePreferencesInput(current, {
        push_enabled: true,
        email_enabled: true,
        types: {
          new_likes: {
            push_enabled: true,
            email_enabled: true,
            inapp_enabled: false,
          },
        },
      });

      await setUserPreferences(updated);

      expect(mockQuery).toHaveBeenCalled();
      const insertCall = mockQuery.mock.calls.find(
        (call) =>
          typeof call[0] === "string" && call[0].includes("INSERT INTO notification_preferences")
      );
      expect(insertCall).toBeDefined();
      expect(insertCall[1][0]).toBe(address);
    });
  });

  describe("Authentication Verification", () => {
    it("rejects write requests without Authorization header", () => {
      const { req } = createMockReqRes({ headers: {} });
      const result = verifyWriteAuth(req, "GADDR1");
      expect(result.ok).toBe(false);
      expect(result.status).toBe(401);
      expect(result.error).toMatch(/authentication required/i);
    });

    it("accepts valid Bearer token", () => {
      const { req } = createMockReqRes({
        headers: { authorization: "Bearer valid-auth-token-123" },
      });
      const result = verifyWriteAuth(req, "GADDR1");
      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
    });

    it("accepts valid StellarSig with matching address", () => {
      const address = "GADDR_MATCH";
      const payload = Buffer.from(
        JSON.stringify({ address, timestamp: Date.now(), signature: "sig" })
      ).toString("base64");
      const { req } = createMockReqRes({ headers: { authorization: `StellarSig ${payload}` } });

      const result = verifyWriteAuth(req, address);
      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
    });

    it("rejects StellarSig with mismatched address (403 Forbidden)", () => {
      const targetAddress = "GADDR_TARGET";
      const imposterAddress = "GADDR_IMPOSTER";
      const payload = Buffer.from(
        JSON.stringify({ address: imposterAddress, timestamp: Date.now() })
      ).toString("base64");
      const { req } = createMockReqRes({ headers: { authorization: `StellarSig ${payload}` } });

      const result = verifyWriteAuth(req, targetAddress);
      expect(result.ok).toBe(false);
      expect(result.status).toBe(403);
      expect(result.error).toMatch(/does not match/i);
    });
  });

  describe("REST API Endpoints", () => {
    it("GET /preferences/:address returns 200 with default preferences", async () => {
      const address = "GBRESTADDR1";
      const { req, res } = createMockReqRes({ params: { address } });
      await getPreferencesHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.address).toBe(address);
      expect(res.body.channels).toEqual({
        push: true,
        email: false,
        inApp: true,
      });
      expect(res.body.push_enabled).toBe(true);
      expect(res.body.email_enabled).toBe(false);
      expect(res.body.inapp_enabled).toBe(true);
      expect(res.body.types).toHaveProperty("new_followers");
      expect(res.body.types).toHaveProperty("new_likes");
      expect(res.body.types).toHaveProperty("new_comments");
      expect(res.body.types).toHaveProperty("direct_messages");
      expect(res.body.types).toHaveProperty("pool_activity");
      expect(res.body.types).toHaveProperty("governance_updates");
    });

    it("PUT /preferences/:address rejects unauthenticated request with 401", async () => {
      const address = "GBRESTADDR2";
      const { req, res } = createMockReqRes({
        params: { address },
        body: { push: false },
        headers: {},
      });
      await updatePreferencesHandler(req, res);

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toMatch(/authentication required/i);
    });

    it("PUT /preferences/:address updates preferences with Bearer auth", async () => {
      const address = "GBRESTADDR3";
      const { req, res } = createMockReqRes({
        params: { address },
        headers: { authorization: "Bearer valid-test-token" },
        body: {
          push_enabled: false,
          email_enabled: true,
          types: {
            new_followers: {
              push_enabled: false,
              email_enabled: true,
              inapp_enabled: true,
            },
          },
        },
      });

      await updatePreferencesHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.push_enabled).toBe(false);
      expect(res.body.email_enabled).toBe(true);
      expect(res.body.channels.push).toBe(false);
      expect(res.body.channels.email).toBe(true);
      expect(res.body.types.new_followers).toEqual({
        push_enabled: false,
        email_enabled: true,
        inapp_enabled: true,
      });

      // Verify that subsequent GET returns the persisted preferences
      const { req: getReq, res: getRes } = createMockReqRes({ params: { address } });
      await getPreferencesHandler(getReq, getRes);

      expect(getRes.statusCode).toBe(200);
      expect(getRes.body.push_enabled).toBe(false);
      expect(getRes.body.email_enabled).toBe(true);
      expect(getRes.body.types.new_followers).toEqual({
        push_enabled: false,
        email_enabled: true,
        inapp_enabled: true,
      });
    });

    it("PUT /preferences/:address updates channel preferences directly", async () => {
      const address = "GBRESTADDR4";
      const { req, res } = createMockReqRes({
        params: { address },
        headers: { authorization: "Bearer token-abc" },
        body: {
          push: false,
          email: false,
          inApp: true,
        },
      });

      await updatePreferencesHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.channels).toEqual({
        push: false,
        email: false,
        inApp: true,
      });
      expect(res.body.push_enabled).toBe(false);
      expect(res.body.email_enabled).toBe(false);
      expect(res.body.inapp_enabled).toBe(true);
    });

    it("PUT /preferences/:address supports per-notification-type preferences", async () => {
      const address = "GBRESTADDR5";
      const { req, res } = createMockReqRes({
        params: { address },
        headers: { authorization: "Bearer token-xyz" },
        body: {
          new_likes: {
            push_enabled: false,
            email_enabled: true,
            inapp_enabled: false,
          },
          governance_updates: {
            push_enabled: true,
            email_enabled: true,
            inapp_enabled: true,
          },
        },
      });

      await updatePreferencesHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.types.new_likes).toEqual({
        push_enabled: false,
        email_enabled: true,
        inapp_enabled: false,
      });
      expect(res.body.types.governance_updates).toEqual({
        push_enabled: true,
        email_enabled: true,
        inapp_enabled: true,
      });
    });

    it("PUT /preferences/:address rejects address mismatch with StellarSig (403)", async () => {
      const targetAddress = "GBTARGET123";
      const differentAddress = "GBDIFFERENT999";
      const payload = Buffer.from(JSON.stringify({ address: differentAddress })).toString("base64");

      const { req, res } = createMockReqRes({
        params: { address: targetAddress },
        headers: { authorization: `StellarSig ${payload}` },
        body: { push: true },
      });

      await updatePreferencesHandler(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/does not match/i);
    });
  });
});
