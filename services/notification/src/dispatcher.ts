import {
  NotificationChannel,
  UserNotificationPreferences,
  getUserPreferences,
} from "./preferences";
import { NotificationQueue } from "./queue";

export interface NotificationPayload {
  id?: string;
  recipient?: string;
  type?: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  createdAt?: string;
}

export interface DispatchResult {
  channel: NotificationChannel;
  success: boolean;
  attempts: number;
  error?: string;
}

export interface DispatchSummary {
  userAddress: string;
  results: DispatchResult[];
}

export type DispatchResponse = DispatchResult[] & DispatchSummary;

export type ChannelSenderFn = (
  preferences: UserNotificationPreferences,
  payload: NotificationPayload
) => Promise<void>;

export interface ChannelSenderObj {
  send: (channel: NotificationChannel, payload: NotificationPayload) => Promise<void>;
}

export type ChannelSender = ChannelSenderFn | ChannelSenderObj;

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 100;

export const defaultSender: ChannelSender = {
  async send(channel: NotificationChannel, _payload: NotificationPayload): Promise<void> {
    if (channel === "push" && process.env.NODE_ENV === "test-fail") {
      throw new Error("Simulated push failure");
    }
  },
};

const channelSenders: Record<NotificationChannel, ChannelSenderFn> = {
  push: async (preferences, payload) => {
    if (process.env.NODE_ENV === "test-fail") {
      throw new Error("Simulated push failure");
    }
    void preferences;
    void payload;
  },
  email: async (preferences, payload) => {
    void preferences;
    void payload;
  },
  "in-app": async (_preferences, payload) => {
    void payload;
  },
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getEnabledChannels(preferences: UserNotificationPreferences): NotificationChannel[];
export function getEnabledChannels(userAddress: string): Promise<NotificationChannel[]>;
export function getEnabledChannels(
  target: string | UserNotificationPreferences
): NotificationChannel[] | Promise<NotificationChannel[]> {
  if (typeof target === "string") {
    return getUserPreferences(target).then((prefs) => {
      const channels: NotificationChannel[] = [];
      if (prefs.channels?.push) channels.push("push");
      if (prefs.channels?.email) channels.push("email");
      if (prefs.channels?.inApp) channels.push("in-app");
      return channels;
    });
  }

  const channels: NotificationChannel[] = [];
  if (target.channels?.push) channels.push("push");
  if (target.channels?.email) channels.push("email");
  if (target.channels?.inApp) channels.push("in-app");
  return channels;
}

async function dispatchToChannel(
  channel: NotificationChannel,
  preferences: UserNotificationPreferences,
  payload: NotificationPayload,
  sender?: ChannelSender
): Promise<DispatchResult> {
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(
        JSON.stringify({
          level: "info",
          event: "notification_dispatch_attempt",
          notificationId: payload.id,
          recipient: preferences.userAddress,
          channel,
          attempt,
        })
      );

      if (sender && "send" in sender && typeof sender.send === "function") {
        await sender.send(channel, payload);
      } else if (typeof sender === "function") {
        await sender(preferences, payload);
      } else {
        await channelSenders[channel](preferences, payload);
      }

      return { channel, success: true, attempts: attempt };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "notification_dispatch_failed",
          notificationId: payload.id,
          recipient: preferences.userAddress,
          channel,
          attempt,
          error: lastError,
        })
      );
      if (attempt < MAX_ATTEMPTS) {
        await delay(BASE_BACKOFF_MS * 2 ** (attempt - 1));
      }
    }
  }

  return {
    channel,
    success: false,
    attempts: MAX_ATTEMPTS,
    error: lastError,
  };
}

export async function dispatch(
  target: string | NotificationPayload,
  payloadOrSender?: NotificationPayload | ChannelSender
): Promise<DispatchResponse> {
  let userAddress: string;
  let payload: NotificationPayload;
  let customSender: ChannelSender | undefined;

  if (typeof target === "string") {
    userAddress = target;
    payload = payloadOrSender as NotificationPayload;
  } else {
    payload = target;
    userAddress = payload.recipient ?? (payload as any).userAddress ?? "";
    customSender = payloadOrSender as ChannelSender | undefined;
  }

  const preferences = await getUserPreferences(userAddress);
  const channels = await getEnabledChannels(userAddress);

  const rawResults = await Promise.all(
    channels.map((channel) =>
      dispatchToChannel(channel, preferences, payload, customSender).catch(
        (error): DispatchResult => ({
          channel,
          success: false,
          attempts: 0,
          error: error instanceof Error ? error.message : String(error),
        })
      )
    )
  );

  const response = rawResults as DispatchResponse;
  response.userAddress = userAddress;
  response.results = rawResults;

  return response;
}

export const notificationQueue = new NotificationQueue<NotificationPayload>(async (payload) => {
  const recipient = payload.recipient ?? "";
  const summary = await dispatch(recipient, payload);
  const failed = summary.results.filter((result) => !result.success);
  if (failed.length > 0) {
    throw new Error(
      `Notification delivery failed for ${failed.map((result) => result.channel).join(", ")}`
    );
  }
});

export function enqueueNotification(payload: NotificationPayload): string {
  return notificationQueue.enqueue(payload);
}
