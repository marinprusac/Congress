import type { ComponentProps } from "react";
import { Link, useMatch } from "react-router-dom";
import { isPlainClick, useStackNav } from "@congress/congress-ui";

// On a phone the list and a chat page are separate screens on the Chats
// stack, so opening one pushes (and slides); on desktop they sit side by
// side, so a page already open in the pane is swapped for the next rather
// than stacked under it.
function isPhone(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(max-width: 640px)").matches;
}

export function useChatNav() {
  const nav = useStackNav();
  const paneOpen = useMatch("/chat/:page") !== null;
  return {
    open: (to: string) => (isPhone() ? nav.push(to) : nav.push(to, { replace: paneOpen, transition: "none" })),
    back: () => nav.pop({ transition: isPhone() ? "pop" : "none" }),
  };
}

// A link to a chat page (a thread, Memory, New chat) from within Chats.
export function ChatLink({ to, onClick, ...props }: Omit<ComponentProps<typeof Link>, "to"> & { to: string }) {
  const chat = useChatNav();
  return (
    <Link
      to={to}
      onClick={(e) => {
        onClick?.(e);
        if (!isPlainClick(e) || props.target) return;
        e.preventDefault();
        chat.open(to);
      }}
      {...props}
    />
  );
}

// The chat pages' back button (phone only - desktop hides it).
export function ChatBackButton({ label = "All chats" }: { label?: string }) {
  const chat = useChatNav();
  return (
    <button type="button" className="chat-back" aria-label={label} onClick={chat.back}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m15 18-6-6 6-6" />
      </svg>
    </button>
  );
}
