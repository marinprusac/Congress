import { useNavigate } from "react-router-dom";
import type { Notification } from "@congress/shared-types";
import { ChamberHeader, formatTimestamp, getChamberIcon, resolveChamberPath, useAppliedTheme } from "@congress/congress-ui";
import { useNotifications } from "@/lib/notifications";

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-6 w-6 text-ink" aria-hidden="true">
      <path d="M6 9a6 6 0 0 1 12 0c0 3.5 1 5 2 6H4c1-1 2-2.5 2-6Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 18a2.5 2.5 0 0 0 5 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// The owner's inbox - every Logs rule's "notify" lands here (and as a Web
// Push). A tab of its own now, where it used to be a bell dropdown.
export function NotificationsPage() {
  useAppliedTheme();
  const navigate = useNavigate();
  const { notifications, unreadCount, isLoading, markRead, markAllRead, dismiss } = useNotifications();

  function open(n: Notification) {
    void markRead(n.id);
    if (!n.chamberUrl) return;
    // A notification's url is relative to its emitting Chamber's own root
    // (e.g. "/e/3"); Congress's own events (chamber "congress") are already
    // root-relative.
    navigate(n.chamber === "congress" ? n.chamberUrl : resolveChamberPath(n.chamberUrl, n.chamber, true));
  }

  return (
    <div className="chamber-shell">
      <ChamberHeader
        icon={<BellIcon />}
        title="Notifications"
        titleHref=""
        extraActions={
          unreadCount > 0 ? (
            <button type="button" className="chamber-header-link" onClick={() => void markAllRead()}>
              Mark all read
            </button>
          ) : undefined
        }
      />
      <main className="chamber-main">
        {isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
        {!isLoading && notifications.length === 0 && <p className="font-mono text-sm text-dust">— Nothing here —</p>}
        <div className="notification-list">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={n.readAt ? "notification-item" : "notification-item notification-item--unread"}
              onClick={() => open(n)}
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
                onClick={(e) => {
                  e.stopPropagation();
                  void dismiss(n.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
