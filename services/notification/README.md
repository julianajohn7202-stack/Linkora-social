# @linkora/notification

Notification service for the Linkora Social protocol.

## Architecture

```
Event Bus (Stellar/Soroban Events)
             │
             ▼
     Notification Service
             │
             ├──► Preference Engine (preferences.ts)
             │
             ▼
   Multi-Channel Dispatcher (dispatcher.ts)
             ├──► Push Channel (APNs / FCM)
             ├──► In-App Channel (PostgreSQL inbox)
             └──► Email Channel (Resend / SES)
```

## Features
- Multi-channel delivery: push, email, and in-app notifications.
- Preference-aware: respects individual user delivery channel settings.
- Independent fault tolerance: failures in one channel do not block other channels.
- Automatic retries with exponential backoff for transient delivery failures.
- Structured JSON logging per delivery attempt.

## Delivery states and on-call verification

Trace a synthetic notification with a caller-supplied payload `id`, such as
`preview-follow-001`, through [`enqueueNotification`](src/dispatcher.ts).
Record the returned `jobId` alongside that ID at enqueue time. Dispatch logs
use `notificationId` from the payload, and dead-letter logs use `jobId`.
The queue does not log a mapping between the two.

| Example state | Implementation and evidence |
| --- | --- |
| Queued | [`enqueue`](src/queue.ts) stores an in-memory job with `attempts: 0` and `enqueuedAt`, then starts processing when a worker is free. The returned `jobId` confirms acceptance into that process. Queue jobs and dead letters are lost on restart. |
| Dispatching | The [dispatcher](src/dispatcher.ts) reads the recipient's global channel flags from [preferences](src/preferences.ts) and attempts enabled channels concurrently. Look for `notification_dispatch_attempt` with `notificationId: preview-follow-001`, `channel: push`, and `attempt: 1`. A disabled channel produces no attempt. |
| Retrying | `notification_dispatch_failed` carries the same notification ID, channel and attempt number. A failing channel gets up to three attempts with 100 ms and 200 ms waits. If a channel exhausts its attempts, the queue handler throws and retries the whole dispatch after 1 s, 2 s and 4 s, so previously successful channels can run again. |
| Dead-lettered | After four failed queue attempts, [the queue](src/queue.ts) retains a process-local record with `failedAt` and logs `notification_dead_lettered` with the recorded `jobId` and `attempts: 4`. There is no automatic replay. |
| Persisted and broadcast | When explicitly wired, [`InAppChannel.send`](src/channels/inapp.ts) inserts an unread `notifications` row, then broadcasts the returned row. Capture the generated row ID at the integration boundary to correlate storage and client receipt. The row ID is assigned independently of the queue ID. |

The [HTTP entry point](src/index.ts) calls dispatch directly for `POST /notify`.
Its HTTP 202 carries per-channel `success` and `attempts` values. This path
bypasses the queue, omits the payload ID, and uses placeholder channel senders.
A success result on this path confirms the sender returned. The in-app adapter's
insert and broadcast require a caller that wires the adapter and its schema.

### Confirm delivery using metadata

- **In-app adapter** — Where the adapter is wired, query only `id`, `created_at`
  and `read` for the returned row ID in the adapter's database. Verify that the
  same ID appears in the intended client's notification list or receipt
  instrumentation. Persistence confirms storage and the client observation
  confirms visibility.
- **Current web inbox** — The [web client](../../apps/web/src/contexts/NotificationsContext.tsx)
  consumes indexer WebSocket events and deduplicates by the client notification
  ID. Use a fixture follow event, correlate its paging token when present with
  the recipient's inbox item ID, and confirm the unread count increases. The
  [indexer dispatch ledger](../indexer/src/notifications/events.ts) tracks
  event-level push dispatch separately through `dispatch_key`.
- **External channels** — For a deployment with a wired sender, correlate
  provider receipt metadata or an instrumented test client's receipt with the
  captured notification ID. A provider's acceptance confirms handoff. A receipt
  on the test device or delivery status from the email provider confirms the
  corresponding downstream outcome. The default HTTP path provides no
  provider delivery evidence.

Record IDs, timestamps, channel, attempt count and outcome. Avoid collecting
titles, bodies, payloads, device tokens, or raw provider error text.

## Development & CI

```bash
# Run unit tests
pnpm test

# Type-check
pnpm typecheck

# Lint
pnpm lint
```
