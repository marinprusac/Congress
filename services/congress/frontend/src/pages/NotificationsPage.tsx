import { useRef, useState } from "react";
import type { Notification } from "@congress/shared-types";
import {
  ChamberHeader,
  formatTimestamp,
  getChamberIcon,
  ListLoadingState,
  prefersReducedMotion,
  resolveChamberPath,
  useAppliedTheme,
  useFlipList,
  useTransitionNavigate,
} from "@congress/congress-ui";
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
  const navigate = useTransitionNavigate();
  const { notifications, unreadCount, isLoading, markRead, markAllRead, dismiss } = useNotifications();
  const listRef = useRef<HTMLDivElement>(null);
  useFlipList(
    listRef,
    notifications.map((n) => String(n.id))
  );
  // Dismissed rows slide out before they're removed.
  const [leaving, setLeaving] = useState<ReadonlySet<Notification["id"]>>(new Set());

  function dismissWithExit(id: Notification["id"]) {
    setLeaving((current) => new Set(current).add(id));
    setTimeout(() => void dismiss(id), prefersReducedMotion() ? 0 : 180);
  }

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
        {isLoading && <ListLoadingState />}
        {!isLoading && notifications.length === 0 && <p className="font-mono text-sm text-dust">— Nothing here —</p>}
        <div className="notification-list" ref={listRef}>
          {notifications.map((n) => (
            <div
              key={n.id}
              data-flip-key={String(n.id)}
              className={`notification-item${n.readAt ? "" : " notification-item--unread"}${leaving.has(n.id) ? " notification-item--leaving" : ""}`}
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
                  dismissWithExit(n.id);
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
