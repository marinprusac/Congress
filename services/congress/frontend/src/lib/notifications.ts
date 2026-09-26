import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationsListResponse } from "@congress/shared-types";

// Congress's own inbox API (notifications.ts) - same-origin in production,
// proxied by vite in dev.
const API_BASE = "/congress";
const POLL_INTERVAL_MS = 60_000;

export const notificationsQueryKey = ["notifications", "inbox"] as const;

async function fetchNotifications(): Promise<NotificationsListResponse> {
  const res = await fetch(`${API_BASE}/notifications`);
  if (!res.ok) return { notifications: [], unreadCount: 0 };
  return res.json();
}

// One shared, polled inbox query - the tab bar's unread badge and the
// Notifications page read the same cache entry.
export function useNotifications() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: notificationsQueryKey, queryFn: fetchNotifications, refetchInterval: POLL_INTERVAL_MS });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: notificationsQueryKey });

  return {
    notifications: query.data?.notifications ?? [],
    unreadCount: query.data?.unreadCount ?? 0,
    isLoading: query.isLoading,
    async markRead(id: number) {
      await fetch(`${API_BASE}/notifications/${id}/read`, { method: "POST" });
      await invalidate();
    },
    async markAllRead() {
      await fetch(`${API_BASE}/notifications/read-all`, { method: "POST" });
      await invalidate();
    },
    async dismiss(id: number) {
      await fetch(`${API_BASE}/notifications/${id}`, { method: "DELETE" });
      await invalidate();
    },
  };
}
