/**
 * @linkora/notification
 *
 * Push and in-app notification delivery service for the Linkora SocialFi
 * platform.  Receives notification events from the indexer, stores device
 * tokens, and fans out push messages via Web Push / FCM / APNs.
 *
 * This file is a stub — implementation will be added in follow-up PRs.
 */

export type NotificationType =
  | "new_follower"
  | "tip_received"
  | "post_liked"
  | "mention"
  | "governance_vote";

export interface NotificationPayload {
  /** Recipient Stellar account address */
  recipientAddress: string;
  type: NotificationType;
  /** Short human-readable title (≤64 chars) */
  title: string;
  /** Notification body text */
  body: string;
  /** Optional deep-link URL */
  actionUrl?: string;
  /** Unix timestamp (ms) when the event occurred */
  occurredAt: number;
}

export interface NotificationService {
  send(payload: NotificationPayload): Promise<void>;
  registerDevice(address: string, token: string): Promise<void>;
  unregisterDevice(address: string, token: string): Promise<void>;
}

/**
 * No-op implementation used during development and tests.
 */
export class NoopNotificationService implements NotificationService {
  async send(_payload: NotificationPayload): Promise<void> {
    // TODO: implement push dispatch
  }

  async registerDevice(_address: string, _token: string): Promise<void> {
    // TODO: persist device token
  }

  async unregisterDevice(_address: string, _token: string): Promise<void> {
    // TODO: remove device token
  }
}
