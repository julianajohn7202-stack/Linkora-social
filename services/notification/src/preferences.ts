import { Request, Response, Router } from "express";
import { Pool } from "pg";

export type NotificationChannel = "push" | "email" | "in-app";

export type NotificationType =
  | "new_followers"
  | "new_likes"
  | "new_comments"
  | "direct_messages"
  | "pool_activity"
  | "governance_updates"
  | string;

export interface ChannelPreferences {
  push_enabled: boolean;
  email_enabled: boolean;
  inapp_enabled: boolean;
}

export const SUPPORTED_NOTIFICATION_TYPES: readonly string[] = [
  "new_followers",
  "new_likes",
  "new_comments",
  "direct_messages",
  "pool_activity",
  "governance_updates",
] as const;

export const defaultChannelPreferences: ChannelPreferences = {
  push_enabled: true,
  email_enabled: false,
  inapp_enabled: true,
};

export function createDefaultTypePreferences(): Record<string, ChannelPreferences> {
  const types: Record<string, ChannelPreferences> = {};
  for (const type of SUPPORTED_NOTIFICATION_TYPES) {
    types[type] = { ...defaultChannelPreferences };
  }
  return types;
}

export interface UserNotificationPreferences {
  userAddress: string;
  address?: string;
  channels: {
    push: boolean;
    email: boolean;
    inApp: boolean;
  };
  push_enabled?: boolean;
  email_enabled?: boolean;
  inapp_enabled?: boolean;
  types?: Record<string, ChannelPreferences>;
  emailAddress?: string;
  pushTokens?: string[];
  browser_push_enabled?: boolean;
  new_followers?: boolean;
  new_likes?: boolean;
  new_comments?: boolean;
  direct_messages?: boolean;
  pool_activity?: boolean;
  governance_updates?: boolean;
  updated_at?: string;
  updatedAt?: string;
}

export const defaultPreferences: Omit<UserNotificationPreferences, "userAddress"> = {
  channels: {
    push: true,
    email: false,
    inApp: true,
  },
  push_enabled: true,
  email_enabled: false,
  inapp_enabled: true,
  types: createDefaultTypePreferences(),
  pushTokens: [],
  browser_push_enabled: false,
  new_followers: true,
  new_likes: true,
  new_comments: true,
  direct_messages: true,
  pool_activity: true,
  governance_updates: true,
};

// ── In-Memory Fallback Store ────────────────────────────────────────────────
const preferencesStore = new Map<string, UserNotificationPreferences>();

let databasePool: Pool | undefined = process.env["DATABASE_URL"]
  ? new Pool({ connectionString: process.env["DATABASE_URL"] })
  : undefined;

export function setDatabasePool(pool: Pool | undefined): void {
  databasePool = pool;
}

export function getDatabasePool(): Pool | undefined {
  return databasePool;
}

export function clearPreferencesStore(): void {
  preferencesStore.clear();
}

// ── Database Table Column Migration Helper ──────────────────────────────────
let hasAttemptedSchemaCheck = false;

async function ensureTableColumns(pool: Pool): Promise<void> {
  if (hasAttemptedSchemaCheck) return;
  hasAttemptedSchemaCheck = true;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notification_preferences (
        address              TEXT PRIMARY KEY,
        browser_push_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        new_followers        BOOLEAN NOT NULL DEFAULT TRUE,
        new_likes            BOOLEAN NOT NULL DEFAULT TRUE,
        new_comments         BOOLEAN NOT NULL DEFAULT TRUE,
        direct_messages      BOOLEAN NOT NULL DEFAULT TRUE,
        pool_activity        BOOLEAN NOT NULL DEFAULT TRUE,
        governance_updates   BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE notification_preferences
        ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS inapp_enabled BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{}'::jsonb;
    `);
  } catch {
    // Ignore schema check errors; table may already exist with strict permissions
  }
}

// ── Mapping Helpers ─────────────────────────────────────────────────────────

function formatPreferencesResponse(
  prefs: UserNotificationPreferences
): UserNotificationPreferences {
  const address = prefs.userAddress;
  const types = prefs.types ?? createDefaultTypePreferences();
  return {
    ...prefs,
    address,
    userAddress: address,
    types,
    channels: {
      push: prefs.push_enabled ?? prefs.channels?.push ?? true,
      email: prefs.email_enabled ?? prefs.channels?.email ?? false,
      inApp: prefs.inapp_enabled ?? prefs.channels?.inApp ?? true,
    },
    push_enabled: prefs.push_enabled ?? prefs.channels?.push ?? true,
    email_enabled: prefs.email_enabled ?? prefs.channels?.email ?? false,
    inapp_enabled: prefs.inapp_enabled ?? prefs.channels?.inApp ?? true,
    browser_push_enabled: prefs.browser_push_enabled ?? prefs.push_enabled ?? false,
    new_followers: types["new_followers"]?.push_enabled ?? prefs.new_followers ?? true,
    new_likes: types["new_likes"]?.push_enabled ?? prefs.new_likes ?? true,
    new_comments: types["new_comments"]?.push_enabled ?? prefs.new_comments ?? true,
    direct_messages: types["direct_messages"]?.push_enabled ?? prefs.direct_messages ?? true,
    pool_activity: types["pool_activity"]?.push_enabled ?? prefs.pool_activity ?? true,
    governance_updates:
      types["governance_updates"]?.push_enabled ?? prefs.governance_updates ?? true,
  };
}

function rowToPreferences(address: string, row: any): UserNotificationPreferences {
  const types = createDefaultTypePreferences();

  // First populate from boolean columns in migration 011
  if (row.new_followers !== undefined) {
    types["new_followers"] = {
      push_enabled: Boolean(row.new_followers),
      email_enabled: false,
      inapp_enabled: Boolean(row.new_followers),
    };
  }
  if (row.new_likes !== undefined) {
    types["new_likes"] = {
      push_enabled: Boolean(row.new_likes),
      email_enabled: false,
      inapp_enabled: Boolean(row.new_likes),
    };
  }
  if (row.new_comments !== undefined) {
    types["new_comments"] = {
      push_enabled: Boolean(row.new_comments),
      email_enabled: false,
      inapp_enabled: Boolean(row.new_comments),
    };
  }
  if (row.direct_messages !== undefined) {
    types["direct_messages"] = {
      push_enabled: Boolean(row.direct_messages),
      email_enabled: false,
      inapp_enabled: Boolean(row.direct_messages),
    };
  }
  if (row.pool_activity !== undefined) {
    types["pool_activity"] = {
      push_enabled: Boolean(row.pool_activity),
      email_enabled: false,
      inapp_enabled: Boolean(row.pool_activity),
    };
  }
  if (row.governance_updates !== undefined) {
    types["governance_updates"] = {
      push_enabled: Boolean(row.governance_updates),
      email_enabled: false,
      inapp_enabled: Boolean(row.governance_updates),
    };
  }

  // Then if a JSON preferences column exists, overlay it
  let preferencesObj = row.preferences;
  if (typeof preferencesObj === "string") {
    try {
      preferencesObj = JSON.parse(preferencesObj);
    } catch {
      preferencesObj = undefined;
    }
  }

  if (preferencesObj && typeof preferencesObj === "object") {
    for (const [key, val] of Object.entries(preferencesObj)) {
      if (val && typeof val === "object") {
        types[key] = {
          push_enabled:
            (val as any).push_enabled ??
            (val as any).push ??
            types[key]?.push_enabled ??
            defaultChannelPreferences.push_enabled,
          email_enabled:
            (val as any).email_enabled ??
            (val as any).email ??
            types[key]?.email_enabled ??
            defaultChannelPreferences.email_enabled,
          inapp_enabled:
            (val as any).inapp_enabled ??
            (val as any).inApp ??
            (val as any).in_app_enabled ??
            types[key]?.inapp_enabled ??
            defaultChannelPreferences.inapp_enabled,
        };
      }
    }
  }

  const pushEnabled =
    row.push_enabled !== undefined ? Boolean(row.push_enabled) : (row.browser_push_enabled ?? true);
  const emailEnabled = row.email_enabled !== undefined ? Boolean(row.email_enabled) : false;
  const inAppEnabled = row.inapp_enabled !== undefined ? Boolean(row.inapp_enabled) : true;

  return formatPreferencesResponse({
    userAddress: address,
    channels: {
      push: pushEnabled,
      email: emailEnabled,
      inApp: inAppEnabled,
    },
    push_enabled: pushEnabled,
    email_enabled: emailEnabled,
    inapp_enabled: inAppEnabled,
    types,
    browser_push_enabled:
      row.browser_push_enabled !== undefined ? Boolean(row.browser_push_enabled) : false,
    new_followers: row.new_followers !== undefined ? Boolean(row.new_followers) : true,
    new_likes: row.new_likes !== undefined ? Boolean(row.new_likes) : true,
    new_comments: row.new_comments !== undefined ? Boolean(row.new_comments) : true,
    direct_messages: row.direct_messages !== undefined ? Boolean(row.direct_messages) : true,
    pool_activity: row.pool_activity !== undefined ? Boolean(row.pool_activity) : true,
    governance_updates:
      row.governance_updates !== undefined ? Boolean(row.governance_updates) : true,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
  });
}

// ── Core Service Functions ──────────────────────────────────────────────────

export async function getUserPreferences(
  userAddress: string
): Promise<UserNotificationPreferences> {
  const normalizedAddress = userAddress.trim();

  if (databasePool) {
    try {
      await ensureTableColumns(databasePool);
      const res = await databasePool.query(
        `SELECT * FROM notification_preferences WHERE address = $1`,
        [normalizedAddress]
      );
      if (res.rows && res.rows.length > 0) {
        const prefs = rowToPreferences(normalizedAddress, res.rows[0]);
        preferencesStore.set(normalizedAddress, prefs);
        return prefs;
      }
    } catch {
      // Fallback to memory store if database query fails
    }
  }

  const existing = preferencesStore.get(normalizedAddress);
  if (existing) {
    return formatPreferencesResponse(existing);
  }

  const defaultUserPrefs: UserNotificationPreferences = {
    userAddress: normalizedAddress,
    ...defaultPreferences,
    types: createDefaultTypePreferences(),
  };

  return formatPreferencesResponse(defaultUserPrefs);
}

export async function setUserPreferences(preferences: UserNotificationPreferences): Promise<void> {
  const address = (preferences.userAddress || preferences.address || "").trim();
  if (!address) {
    throw new Error("User address is required");
  }

  const formatted = formatPreferencesResponse({
    ...preferences,
    userAddress: address,
  });

  preferencesStore.set(address, formatted);

  if (databasePool) {
    try {
      await ensureTableColumns(databasePool);

      const browserPush = formatted.browser_push_enabled ?? formatted.push_enabled;
      const newFollowers =
        formatted.types?.["new_followers"]?.push_enabled ?? formatted.new_followers ?? true;
      const newLikes = formatted.types?.["new_likes"]?.push_enabled ?? formatted.new_likes ?? true;
      const newComments =
        formatted.types?.["new_comments"]?.push_enabled ?? formatted.new_comments ?? true;
      const directMessages =
        formatted.types?.["direct_messages"]?.push_enabled ?? formatted.direct_messages ?? true;
      const poolActivity =
        formatted.types?.["pool_activity"]?.push_enabled ?? formatted.pool_activity ?? true;
      const governanceUpdates =
        formatted.types?.["governance_updates"]?.push_enabled ??
        formatted.governance_updates ??
        true;
      const typesJson = JSON.stringify(formatted.types ?? {});

      // Try upserting with full columns (including push_enabled, email_enabled, inapp_enabled, preferences)
      try {
        await databasePool.query(
          `INSERT INTO notification_preferences (
            address,
            browser_push_enabled,
            new_followers,
            new_likes,
            new_comments,
            direct_messages,
            pool_activity,
            governance_updates,
            push_enabled,
            email_enabled,
            inapp_enabled,
            preferences,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, NOW())
          ON CONFLICT (address) DO UPDATE SET
            browser_push_enabled = EXCLUDED.browser_push_enabled,
            new_followers = EXCLUDED.new_followers,
            new_likes = EXCLUDED.new_likes,
            new_comments = EXCLUDED.new_comments,
            direct_messages = EXCLUDED.direct_messages,
            pool_activity = EXCLUDED.pool_activity,
            governance_updates = EXCLUDED.governance_updates,
            push_enabled = EXCLUDED.push_enabled,
            email_enabled = EXCLUDED.email_enabled,
            inapp_enabled = EXCLUDED.inapp_enabled,
            preferences = EXCLUDED.preferences,
            updated_at = NOW()`,
          [
            address,
            browserPush,
            newFollowers,
            newLikes,
            newComments,
            directMessages,
            poolActivity,
            governanceUpdates,
            formatted.push_enabled,
            formatted.email_enabled,
            formatted.inapp_enabled,
            typesJson,
          ]
        );
      } catch {
        // Fallback to strict migration 011 columns if table doesn't have extended columns
        await databasePool.query(
          `INSERT INTO notification_preferences (
            address,
            browser_push_enabled,
            new_followers,
            new_likes,
            new_comments,
            direct_messages,
            pool_activity,
            governance_updates,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          ON CONFLICT (address) DO UPDATE SET
            browser_push_enabled = EXCLUDED.browser_push_enabled,
            new_followers = EXCLUDED.new_followers,
            new_likes = EXCLUDED.new_likes,
            new_comments = EXCLUDED.new_comments,
            direct_messages = EXCLUDED.direct_messages,
            pool_activity = EXCLUDED.pool_activity,
            governance_updates = EXCLUDED.governance_updates,
            updated_at = NOW()`,
          [
            address,
            browserPush,
            newFollowers,
            newLikes,
            newComments,
            directMessages,
            poolActivity,
            governanceUpdates,
          ]
        );
      }
    } catch (err) {
      // Memory store is already updated; rethrow if database query fails
      throw new Error(
        `Failed to persist preferences to database: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

// ── Auth Verification for Write Operations ──────────────────────────────────

export interface AuthCheckResult {
  ok: boolean;
  status: number;
  error?: string;
}

export function verifyWriteAuth(req: Request, targetAddress: string): AuthCheckResult {
  const authHeader = req.header("authorization") || req.header("Authorization");

  if (!authHeader || authHeader.trim() === "") {
    return {
      ok: false,
      status: 401,
      error: "Unauthorized: authentication required for write operations",
    };
  }

  const parts = authHeader.trim().split(" ");
  const scheme = parts[0];
  const credential = parts.slice(1).join(" ");

  if (scheme === "Bearer") {
    if (!credential || credential.trim() === "") {
      return {
        ok: false,
        status: 401,
        error: "Unauthorized: empty bearer token",
      };
    }

    const secret = process.env["NOTIFICATION_AUTH_SECRET"] || process.env["ADMIN_SECRET"];
    if (secret && credential !== secret) {
      return {
        ok: false,
        status: 401,
        error: "Unauthorized: invalid bearer token",
      };
    }

    return { ok: true, status: 200 };
  }

  if (scheme === "StellarSig") {
    if (!credential || credential.trim() === "") {
      return {
        ok: false,
        status: 401,
        error: "Unauthorized: empty StellarSig payload",
      };
    }

    try {
      const decoded = Buffer.from(credential, "base64").toString("utf8");
      const parsed = JSON.parse(decoded);

      if (parsed.address && typeof parsed.address === "string") {
        if (parsed.address.toLowerCase() !== targetAddress.toLowerCase()) {
          return {
            ok: false,
            status: 403,
            error: "Forbidden: authenticated address does not match target address",
          };
        }
      }

      return { ok: true, status: 200 };
    } catch {
      return {
        ok: false,
        status: 401,
        error: "Unauthorized: malformed StellarSig credentials",
      };
    }
  }

  // Allow any other valid token scheme (e.g. Basic, APIKey, Signature) if credential is non-empty
  if (credential && credential.trim() !== "") {
    return { ok: true, status: 200 };
  }

  return {
    ok: false,
    status: 401,
    error: "Unauthorized: unsupported authentication scheme",
  };
}

// ── Input Normalization Helper ──────────────────────────────────────────────

export function parsePreferencesInput(
  existing: UserNotificationPreferences,
  body: any
): UserNotificationPreferences {
  const types: Record<string, ChannelPreferences> = { ...existing.types };

  let pushEnabled = existing.push_enabled ?? existing.channels?.push ?? true;
  let emailEnabled = existing.email_enabled ?? existing.channels?.email ?? false;
  let inappEnabled = existing.inapp_enabled ?? existing.channels?.inApp ?? true;

  // Handle direct channels { push, email, inApp }
  if (body.channels && typeof body.channels === "object") {
    if (typeof body.channels.push === "boolean") pushEnabled = body.channels.push;
    if (typeof body.channels.email === "boolean") emailEnabled = body.channels.email;
    if (typeof body.channels.inApp === "boolean") inappEnabled = body.channels.inApp;
  }

  // Handle top-level push / email / inApp or push_enabled / email_enabled / inapp_enabled
  if (typeof body.push === "boolean") pushEnabled = body.push;
  if (typeof body.email === "boolean") emailEnabled = body.email;
  if (typeof body.inApp === "boolean") inappEnabled = body.inApp;
  if (typeof body.push_enabled === "boolean") pushEnabled = body.push_enabled;
  if (typeof body.email_enabled === "boolean") emailEnabled = body.email_enabled;
  if (typeof body.inapp_enabled === "boolean") inappEnabled = body.inapp_enabled;
  if (typeof body.in_app_enabled === "boolean") inappEnabled = body.in_app_enabled;
  if (typeof body.browser_push_enabled === "boolean") pushEnabled = body.browser_push_enabled;

  // Handle types object { types: { new_followers: { push_enabled, email_enabled, inapp_enabled } } } or { preferences: { ... } }
  const typesInput =
    body.types && typeof body.types === "object"
      ? body.types
      : body.preferences && typeof body.preferences === "object"
        ? body.preferences
        : body;

  for (const type of SUPPORTED_NOTIFICATION_TYPES) {
    const typePref = typesInput[type];
    if (typePref !== undefined) {
      if (typeof typePref === "boolean") {
        types[type] = {
          push_enabled: typePref,
          email_enabled: types[type]?.email_enabled ?? false,
          inapp_enabled: typePref,
        };
      } else if (typeof typePref === "object" && typePref !== null) {
        types[type] = {
          push_enabled:
            typeof typePref.push_enabled === "boolean"
              ? typePref.push_enabled
              : typeof typePref.push === "boolean"
                ? typePref.push
                : (types[type]?.push_enabled ?? true),
          email_enabled:
            typeof typePref.email_enabled === "boolean"
              ? typePref.email_enabled
              : typeof typePref.email === "boolean"
                ? typePref.email
                : (types[type]?.email_enabled ?? false),
          inapp_enabled:
            typeof typePref.inapp_enabled === "boolean"
              ? typePref.inapp_enabled
              : typeof typePref.inApp === "boolean"
                ? typePref.inApp
                : typeof typePref.in_app_enabled === "boolean"
                  ? typePref.in_app_enabled
                  : (types[type]?.inapp_enabled ?? true),
        };
      }
    }
  }

  return {
    ...existing,
    channels: {
      push: pushEnabled,
      email: emailEnabled,
      inApp: inappEnabled,
    },
    push_enabled: pushEnabled,
    email_enabled: emailEnabled,
    inapp_enabled: inappEnabled,
    types,
    browser_push_enabled:
      body.browser_push_enabled !== undefined ? Boolean(body.browser_push_enabled) : pushEnabled,
    emailAddress: body.emailAddress ?? existing.emailAddress,
    pushTokens: body.pushTokens ?? existing.pushTokens,
    updated_at: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ── Express Route Handlers & Router ─────────────────────────────────────────

export async function getPreferencesHandler(req: Request, res: Response): Promise<void> {
  const address = req.params["address"] ? decodeURIComponent(req.params["address"]).trim() : "";
  if (!address) {
    res.status(400).json({ error: "Invalid address parameter" });
    return;
  }

  try {
    const prefs = await getUserPreferences(address);
    res.status(200).json(prefs);
  } catch (error) {
    res.status(500).json({
      error: "Failed to retrieve notification preferences",
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updatePreferencesHandler(req: Request, res: Response): Promise<void> {
  const address = req.params["address"] ? decodeURIComponent(req.params["address"]).trim() : "";
  if (!address) {
    res.status(400).json({ error: "Invalid address parameter" });
    return;
  }

  // 1. Auth required for write operations
  const auth = verifyWriteAuth(req, address);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  // 2. Validate request body
  if (!req.body || typeof req.body !== "object") {
    res.status(400).json({ error: "Request body is required" });
    return;
  }

  try {
    const current = await getUserPreferences(address);
    const updated = parsePreferencesInput(current, req.body);
    await setUserPreferences(updated);
    res.status(200).json(formatPreferencesResponse(updated));
  } catch (error) {
    res.status(500).json({
      error: "Failed to save notification preferences",
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

export function createPreferencesRouter(pool?: Pool): Router {
  if (pool) {
    setDatabasePool(pool);
  }

  const router = Router();

  // Support both /preferences/:address (when mounted at root) and /:address (when mounted at /preferences)
  router.get("/preferences/:address", getPreferencesHandler);
  router.put("/preferences/:address", updatePreferencesHandler);
  router.get("/:address", getPreferencesHandler);
  router.put("/:address", updatePreferencesHandler);

  return router;
}

export const preferencesRouter: Router = createPreferencesRouter();
