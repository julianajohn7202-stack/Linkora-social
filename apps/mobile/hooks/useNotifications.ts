import { useCallback, useEffect, useState } from "react";
import {
  getCachedNotifications,
  initDatabase,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
} from "../utils/db";

export type { Notification } from "../utils/db";

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      await initDatabase();
      setNotifications(await getCachedNotifications());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const markRead = useCallback(async (id: string) => {
    await markNotificationRead(id);
    setNotifications((items) => items.map((item) => item.id === id ? { ...item, read: true } : item));
  }, []);
  const markAllRead = useCallback(async () => {
    await markAllNotificationsRead();
    setNotifications((items) => items.map((item) => ({ ...item, read: true })));
  }, []);

  const unreadCount = notifications.filter((item) => !item.read).length;
  return { notifications, unreadCount, loading, refreshing, error, refresh, markRead, markAllRead };
}
