# Notification Service

The notification service is embedded inside the **indexer** (`services/indexer`). It listens on the internal `EventBus`, maps on-chain Soroban events to user-facing notifications, and dispatches them through one of two channels: **Expo push** (mobile) or **Web Push** (browser).

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Soroban RPC  ──►  Stream / Poller  ──►  Pipeline               │
│                                                 │                │
│                                                 ▼                │
│                                          EventBus (bus.ts)       │
│                                           (in-process pub/sub)   │
└──────────────────────────────────┬───────────────────────────────┘
                                   │  bus.on("*", handler)
                                   ▼
          ┌────────────────────────────────────────────┐
          │  Notification Dispatcher                   │
          │  (attachNotificationDispatcher)            │
          │                                            │
          │  1. parseNotificationEvent(busEvent)       │
          │     Decodes XDR topics + data              │
          │     Extracts: type, recipient, payload     │
          │                                            │
          │  2. isAlreadyDispatched(pool, event, …)    │
          │     Checks sent_notifications table        │
          │     (idempotent – keyed by dispatch_key)   │
          │                                            │
          │  3. NotificationService.dispatchEvent…()   │
          │     Checks user preferences                │
          │     Looks up device token                  │
          │              │                             │
          │     ┌────────┴─────────┐                  │
          │     ▼                  ▼                   │
          │  Mobile Push        Web Push               │
          │  (Expo API)         (web-push stub)        │
          │  token: string      token: JSON object     │
          │  platform: ios|     platform: web          │
          │           android                          │
          │                                            │
          │  4. markDispatched(pool, event, …)         │
          │     Writes dispatch_key to                 │
          │     sent_notifications (ON CONFLICT IGNORE)│
          └────────────────────────────────────────────┘
```

### Component summary

| Component                        | Location                                     | Responsibility                                                  |
| -------------------------------- | -------------------------------------------- | --------------------------------------------------------------- |
| `EventBus`                       | `src/bus.ts`                                 | In-process pub/sub; publishes every decoded contract event      |
| `parseNotificationEvent`         | `src/notifications/events.ts`                | Decodes XDR topics/data into a typed `LinkoraNotificationEvent` |
| `attachNotificationDispatcher`   | `src/notifications/events.ts`                | Wires the EventBus wildcard listener to the dispatcher          |
| `NotificationService`            | `src/notifications/service.ts`               | Device-token store + preference checks + channel dispatch       |
| `sent_notifications` table       | migration `008_sent_notifications.sql`       | Deduplication — one row per `dispatch_key`                      |
| `notification_preferences` table | migration `011_notification_preferences.sql` | Per-user opt-in/out settings                                    |
| `device_tokens` table            | migration `007_device_tokens.sql`            | Registered push endpoints per address                           |

---

## Event Types

The dispatcher handles the following on-chain event types:

| Contract event               | Notification type            | Recipient                            |
| ---------------------------- | ---------------------------- | ------------------------------------ |
| `follow`                     | `FOLLOW`                     | The user being followed (`followee`) |
| `tip`                        | `TIP_RECEIVED`               | Author of the tipped post            |
| `like`                       | `LIKE_RECEIVED`              | Author of the liked post             |
| `post_reported`              | `POST_REPORTED`              | Author of the reported post          |
| `report_dismissed`           | `REPORT_DISMISSED`           | Reporter who filed the report        |
| `post_removed_by_moderation` | `POST_REMOVED_BY_MODERATION` | Author of the removed post           |

---

## Channel Priority and Fallback Rules

The service dispatches to **one channel per recipient per event**, selected by inspecting the stored device token:

1. **Device token lookup** — `NotificationService.getDeviceToken(address)` returns the most-recently registered token for the address (ordered by `updated_at DESC`).
2. **Channel selection**:
   - Token starts with `{` → treated as a Web Push subscription JSON object → **web-push** path.
   - Any other non-empty string → treated as an Expo push token → **mobile push** path.
3. **No token** → notification is silently skipped (returns `false`). No retry is scheduled.
4. **User preference check** — before token lookup, `shouldSendNotification` reads `notification_preferences`. If the user has opted out of the relevant category, the dispatch is skipped.
5. **Idempotency** — after a successful dispatch, a `dispatch_key` (`ledgerSeq-eventIndex|type|recipient`) is written to `sent_notifications`. Duplicate events (e.g., from RPC backfill) will be detected before the token lookup and discarded.

### Priority summary

```
EventBus event
      │
      ▼
 Check preferences ──► opted out? → skip (no notification)
      │
      ▼
 Check sent_notifications ──► already sent? → skip (idempotent)
      │
      ▼
 Lookup device token ──► no token? → skip
      │
      ├── token starts with "{" ──► Web Push channel
      └── otherwise             ──► Expo mobile push channel
```

---

## Environment Variables

All variables are read from the indexer's environment (`.env` or shell). The notification service does not have its own process — it runs inside `services/indexer`.

| Variable                 | Required | Default       | Description                                                                                                                                                |
| ------------------------ | -------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUSH_ACCESS_TOKEN` | No       | _(none)_      | Bearer token for the Expo push API (`https://exp.host/--/api/v2/push/send`). When unset, mobile pushes are no-ops (the default `sendPush` returns `null`). |
| `DATABASE_URL`           | Yes      | —             | PostgreSQL connection string. Required for the `PostgresDeviceTokenStore` and `sent_notifications` deduplication.                                          |
| `NODE_ENV`               | No       | `development` | When `production`, missing `REDIS_URL` causes startup failure (rate limiter enforcement — shared with the indexer).                                        |

> **Web Push**: The current implementation logs web-push dispatches to stdout rather than calling an external API. To enable real browser push, replace the `token.startsWith("{")` branch in `NotificationService.dispatchEventNotification` with a call to the `web-push` npm library, passing the VAPID keys below.

| Variable            | Required for web push | Description                                  |
| ------------------- | --------------------- | -------------------------------------------- |
| `VAPID_PUBLIC_KEY`  | Yes                   | VAPID public key for Web Push authentication |
| `VAPID_PRIVATE_KEY` | Yes                   | VAPID private key                            |
| `VAPID_SUBJECT`     | Yes                   | `mailto:` or URL contact for the push server |

---

## Local Development Setup

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9
- Docker + Compose v2 (for PostgreSQL)

### Steps

```bash
# 1. Start PostgreSQL
cd services/indexer
cp .env.example .env
# Edit .env: set DATABASE_URL, STELLAR_RPC_URL, CONTRACT_ID

docker compose up -d postgres

# 2. Run migrations (creates device_tokens, sent_notifications, notification_preferences tables)
pnpm --filter indexer migrate
# or directly:
bash services/indexer/migrate.sh

# 3. Start the indexer (notification dispatcher starts automatically)
pnpm --filter indexer dev
```

The notification dispatcher is wired automatically in `services/indexer/src/index.ts` when the indexer boots. It attaches to the shared `EventBus` via `attachNotificationDispatcher(bus, pool, notificationService)`.

### Testing without Expo credentials

Without `EXPO_PUSH_ACCESS_TOKEN`, the `defaultSendPush` function returns `null` but does **not** throw. You can verify the dispatcher is wiring correctly by watching the log output:

```
[web-push] Sending push notification to web user G...: title="New follower", body="..."
```

Mobile push will be attempted silently (HTTP call skipped when token is absent).

### Registering a device token manually (development)

Use the indexer REST API:

```bash
# Register a device token
curl -X POST http://localhost:3000/api/notifications/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <stellar-jwt>" \
  -d '{"token": "ExponentPushToken[xxx]", "platform": "ios"}'

# Register a web push subscription (JSON object serialised as string)
curl -X POST http://localhost:3000/api/notifications/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <stellar-jwt>" \
  -d '{"token": "{\"endpoint\":\"https://...\",\"keys\":{...}}", "platform": "web"}'
```

### Running notification unit tests

```bash
pnpm --filter indexer test -- --testPathPattern=notifications
```

---

## Database Schema Overview

```sql
-- Registered push endpoints
device_tokens (address TEXT, token TEXT, platform TEXT, updated_at TIMESTAMPTZ)
  PRIMARY KEY (address, token)

-- Deduplication log
sent_notifications (event_id BIGINT, event_type TEXT, recipient TEXT, dispatch_key TEXT)
  UNIQUE (dispatch_key)

-- Per-user preferences
notification_preferences (
  address TEXT PRIMARY KEY,
  browser_push_enabled BOOLEAN,
  new_followers BOOLEAN,
  new_likes BOOLEAN,
  new_comments BOOLEAN,
  direct_messages BOOLEAN,
  pool_activity BOOLEAN,
  governance_updates BOOLEAN,
  updated_at TIMESTAMPTZ
)
```

See `services/indexer/migrations/` for the canonical schema definitions.
