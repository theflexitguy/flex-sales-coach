import { useEffect } from "react";
import { create } from "zustand";
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

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  fetch: () => Promise<void>;
  markAllRead: () => Promise<void>;
  clearAll: () => Promise<void>;
}

const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  unreadCount: 0,

  fetch: async () => {
    try {
      const data = await apiGet<{ notifications: Notification[]; unreadCount: number }>("/api/notifications");
      set({ notifications: data.notifications, unreadCount: data.unreadCount });
    } catch { /* ignore */ }
  },

  markAllRead: async () => {
    try {
      await apiPatch("/api/notifications", { markAllRead: true });
      set((s) => ({
        unreadCount: 0,
        notifications: s.notifications.map((n) => ({ ...n, read: true })),
      }));
    } catch { /* ignore */ }
  },

  clearAll: async () => {
    try {
      await apiPost("/api/notifications/clear", {});
      set({ notifications: [], unreadCount: 0 });
    } catch { /* ignore */ }
  },
}));

export function useNotifications() {
  const store = useNotificationStore();

  useEffect(() => {
    store.fetch();
    const interval = setInterval(store.fetch, 30000);
    return () => clearInterval(interval);
  }, []);

  return {
    notifications: store.notifications,
    unreadCount: store.unreadCount,
    refresh: store.fetch,
    markAllRead: store.markAllRead,
    clearAll: store.clearAll,
  };
}
