import { useState, useEffect, useCallback } from "react";
import { apiGet, apiPost, apiPatch } from "../services/api";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetch_ = useCallback(async () => {
    try {
      const data = await apiGet<{ notifications: Notification[]; unreadCount: number }>("/api/notifications");
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetch_();
    const interval = setInterval(fetch_, 30000);
    return () => clearInterval(interval);
  }, [fetch_]);

  const markAllRead = useCallback(async () => {
    try {
      await apiPatch("/api/notifications", { markAllRead: true });
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch { /* ignore */ }
  }, []);

  const clearAll = useCallback(async () => {
    try {
      await apiPost("/api/notifications/clear", {});
      setNotifications([]);
      setUnreadCount(0);
    } catch { /* ignore */ }
  }, []);

  return { notifications, unreadCount, refresh: fetch_, markAllRead, clearAll };
}
