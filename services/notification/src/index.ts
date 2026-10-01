/**
 * @linkora/notification
 *
 * Push, email, and in-app delivery of social events for the Linkora
 * social protocol. Supports Web Push (VAPID), APNs, FCM, and in-app
 * notification feeds.
 *
 * This service is a stub — full implementation is tracked in the project
 * roadmap.
 */

export type NotificationChannel = "web_push" | "apns" | "fcm" | "in_app";

export type NotificationEventType =
  | "new_follower"
  | "tip_received"
  | "post_liked"
  | "post_commented"
  | "governance_update"
  | "pool_activity"
  | "dm_received";

export interface NotificationPayload {
  /** Unique idempotency key to prevent duplicate delivery. */
  idempotencyKey: string;
  /** Stellar address of the recipient. */
  recipient: string;
  eventType: NotificationEventType;
  title: string;
  body: string;
  /** Optional deep-link URL. */
  url?: string;
  /** ISO-8601 timestamp the originating event occurred. */
  occurredAt: string;
}

export interface DeliveryResult {
  idempotencyKey: string;
  channel: NotificationChannel;
  success: boolean;
  error?: string;
}

/**
 * Stub dispatcher — logs the notification payload and returns a mock
 * successful delivery result.
 *
 * Replace with a real implementation that calls the appropriate push provider.
 *
 * @param payload - Notification to dispatch.
 * @param channel - Target delivery channel.
 * @returns A {@link DeliveryResult} indicating success or failure.
 */
export async function dispatch(
  payload: NotificationPayload,
  channel: NotificationChannel
): Promise<DeliveryResult> {
  // Stub: real implementation would call VAPID, APNs, FCM, or insert into DB.
  console.log(`[notification] dispatch channel=${channel}`, payload);
  return {
    idempotencyKey: payload.idempotencyKey,
    channel,
    success: true,
  };
}
