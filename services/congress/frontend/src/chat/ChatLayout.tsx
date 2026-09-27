import { Link, Outlet, useMatch } from "react-router-dom";
import { CapitolMark, useAppliedTheme } from "@congress/congress-ui";
import { ThreadList } from "./ThreadList";
import { useVisualViewportVars } from "./useVisualViewport";
import "./chat.css";

// /chat: the thread list beside the open thread on desktop; one or the
// other on a phone.
export function ChatLayout() {
  useAppliedTheme();
  useVisualViewportVars();
  const threadOpen = useMatch("/chat/:threadId") !== null;
  return (
    <div className={`chat-page${threadOpen ? " chat-page--thread" : ""}`}>
      <aside className="chat-aside">
        <ThreadList />
      </aside>
      <main className="chat-main">
        <Outlet />
      </main>
    </div>
  );
}

export function ChatIndex() {
  return (
    <div className="chat-placeholder">
      <CapitolMark className="chat-placeholder-mark" />
      <p>Pick a chat, or start a new one.</p>
      <Link to="/chat/new" className="chat-inline-action">
        New chat
      </Link>
    </div>
  );
}
