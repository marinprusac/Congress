import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { isPlainClick, selectNavTab, tabOfPath, useActiveNavTab, type NavTab } from "@congress/congress-ui";
import { useNotifications } from "@/lib/notifications";
import { CreateSheet } from "@/components/CreateSheet";
import { useThreads } from "@/chat/useChatData";

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={2} aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M6 9a6 6 0 0 1 12 0c0 3.5 1 5 2 6H4c1-1 2-2.5 2-6Z" />
      <path d="M9.5 18a2.5 2.5 0 0 0 5 0" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M4 5h16v11H9l-5 4V5Z" />
      <path d="M8 9.5h8M8 12.5h5" />
    </svg>
  );
}

export function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
}

function Tab({
  tab,
  to,
  label,
  ariaLabel = label,
  active,
  className,
  children,
}: {
  tab: NavTab;
  to: string;
  label: string;
  ariaLabel?: string;
  active: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    // A tap restores that tab's own stack, or pops the active tab to its
    // root - never a plain push (see navStack.ts).
    <Link
      to={to}
      onClick={(e) => {
        if (!isPlainClick(e)) return;
        e.preventDefault();
        selectNavTab(tab);
      }}
      className={`shell-tab${active ? " active" : ""}${className ? ` ${className}` : ""}`}
      aria-label={ariaLabel}
      aria-current={active ? "page" : undefined}>
      {children}
      <span className="shell-tab-label">{label}</span>
    </Link>
  );
}

// The shell's one navigation: Home · Search · + · Notifications · Settings.
// A bottom tab bar on a phone, a slim left rail on desktop (see index.css).
// There is no per-Chamber navigation any more - Chambers are reached through
// the feed, Search, and the "+" sheet.
export function TabBar() {
  const { pathname } = useLocation();
  const { unreadCount } = useNotifications();
  // Chats needing a look: unread, or waiting on an answer.
  const threads = useThreads(false);
  const chatBadge = (threads.data ?? []).filter((t) => t.unread || t.openAskCount > 0).length;
  // The tab whose stack is showing - a note opened from Search keeps Search lit.
  const active = useActiveNavTab() ?? tabOfPath(pathname);
  const [creating, setCreating] = useState(false);
  // Slot of the active tab, for the sliding indicator (2 is "+").
  const activeIndex = active === "home" ? 0 : active === "search" ? 1 : active === "chats" ? 3 : active === "notifications" ? 4 : -1;

  // "/" jumps to Search from anywhere that isn't a text field (desktop).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || isEditable(document.activeElement)) return;
      e.preventDefault();
      selectNavTab("search");
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <nav className="shell-tabbar" aria-label="Congress">
        <span
          className="shell-tab-indicator"
          aria-hidden="true"
          style={{ "--tab-index": Math.max(activeIndex, 0), opacity: activeIndex < 0 ? 0 : 1 } as CSSProperties}
        />
        <Tab tab="home" to="/" label="Home" active={active === "home"}>
          <HomeIcon />
        </Tab>
        <Tab tab="search" to="/search" label="Search" active={active === "search"}>
          <SearchIcon />
        </Tab>
        <button type="button" className={`shell-tab shell-tab--create${creating ? " open" : ""}`}
          aria-label="Create"
          aria-expanded={creating}
          onClick={() => setCreating((open) => !open)}>
          <span className="shell-tab-create-mark">
            <PlusIcon />
          </span>
          <span className="shell-tab-label">New</span>
        </button>
        <Tab tab="chats" to="/chat" label="Chats" ariaLabel={chatBadge > 0 ? `Chats, ${chatBadge} need you` : "Chats"} active={active === "chats"}>
          <ChatIcon />
          {chatBadge > 0 && <span key={chatBadge} className="shell-tab-badge shell-tab-badge--accent">{chatBadge > 9 ? "9+" : chatBadge}</span>}
        </Tab>
        <Tab
          tab="notifications"
          to="/notifications"
          label="Inbox"
          ariaLabel={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
          active={active === "notifications"}>
          <BellIcon />
          {unreadCount > 0 && <span key={unreadCount} className="shell-tab-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
        </Tab>
      </nav>
      <CreateSheet open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
