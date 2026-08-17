import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { resolveApiBase, useShellHosted, navigateToExhibit, formatTimestamp, getChamberIcon } from "@congress/congress-ui";
import type { Notification, NotificationsListResponse } from "@congress/shared-types";

interface NotificationBellProps {
  // Same purpose as GlobalExhibitSearch's own prop: which Chamber's app this
  // bell is mounted in, so clicking a same-Chamber notification can use the
  // local router instead of a full navigation - see navigateToExhibit.
  ownChamber: string;
  navigate: (path: string) => void;
}

const POLL_INTERVAL_MS = 60_000;

// This Chamber's own api base - same pattern as any Chamber's own
// lib/api.ts (e.g. chamber-tasks/frontend/src/lib/api.ts): /api in dev
// (this Chamber's own dev proxy), /api/notifications in prod (Congress's
// gateway prefix, stripped before forwarding to this Chamber's apiBase).
const API_BASE = resolveApiBase("notifications", import.meta.env.PROD);

function notificationsQueryKey() {
  return ["notifications", "inbox"] as const;
}

async function fetchNotifications(): Promise<NotificationsListResponse> {
  const res = await fetch(`${API_BASE}/notifications`);
  if (!res.ok) return { notifications: [], unreadCount: 0 };
  return res.json();
}

// This Chamber's own inbox - the one place every automation's "task due",
// "event starting soon" (etc.) alert surfaces. Lives here rather than in
// congress-ui: it's this Chamber's own UI, not shared cross-Chamber chrome
// (unlike GlobalExhibitSearch or ChamberHeader) - only ever used by this
// Chamber's own NotificationsWidget. Rendered as this Chamber's 1x1
// homepage widget rather than fixed header chrome - see that component's
// own comment for why the panel stays position:fixed at every breakpoint
// instead of anchoring to the trigger.
export function NotificationBell({ ownChamber, navigate }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: notificationsQueryKey(),
    queryFn: fetchNotifications,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  useEffect(() => {
    if (!open) return;
    function onOutsideDown(e: MouseEvent) {
      if (!(e.target instanceof Node) || ref.current?.contains(e.target)) return;
      setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onOutsideDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onOutsideDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: notificationsQueryKey() });
  }

  async function markRead(id: number) {
    await fetch(`${API_BASE}/notifications/${id}/read`, { method: "POST" });
    invalidate();
  }

  async function markAllRead() {
    await fetch(`${API_BASE}/notifications/read-all`, { method: "POST" });
    invalidate();
  }

  async function dismiss(e: ReactMouseEvent<HTMLButtonElement>, id: number) {
    e.stopPropagation();
    await fetch(`${API_BASE}/notifications/${id}`, { method: "DELETE" });
    invalidate();
  }

  function openNotification(n: Notification) {
    if (!n.readAt) void markRead(n.id);
    if (n.chamberUrl) {
      navigateToExhibit(ownChamber, { id: String(n.id), chamber: n.chamber, name: n.title, url: n.chamberUrl }, navigate, shellHosted);
    }
    setOpen(false);
  }

  return (
    <div className="notification-bell" ref={ref}>
      <button
        type="button"
        className="notification-bell-trigger"
        aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
          <path d="M6 9a6 6 0 0 1 12 0c0 3.5 1 5 2 6H4c1-1 2-2.5 2-6Z" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9.5 18a2.5 2.5 0 0 0 5 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unreadCount > 0 && <span className="notification-bell-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>

      <div className="notification-panel" role="dialog" aria-label="Notifications" hidden={!open}>
        <div className="notification-panel-header">
          <span>Notifications</span>
          {unreadCount > 0 && (
            <button type="button" className="notification-panel-mark-all" onClick={markAllRead}>
              Mark all read
            </button>
          )}
        </div>
        {notifications.length === 0 && <div className="notification-empty">Nothing here</div>}
        {notifications.map((n) => (
          <div
            key={n.id}
            className={n.readAt ? "notification-item" : "notification-item unread"}
            onClick={() => openNotification(n)}
          >
            <span className="notification-item-icon">{getChamberIcon(n.chamber)}</span>
            <div className="notification-item-body">
              <div className="notification-item-title">{n.title}</div>
              {n.body && <div className="notification-item-text">{n.body}</div>}
              <div className="notification-item-meta">{formatTimestamp(n.createdAt)}</div>
            </div>
            <button
              type="button"
              className="notification-item-dismiss tap-target"
              aria-label="Dismiss"
              onClick={(e) => dismiss(e, n.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
