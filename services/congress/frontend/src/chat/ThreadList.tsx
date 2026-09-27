import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import type { AiThread } from "@congress/shared-types";
import { ThreadActions } from "./ThreadActions";
import { listStamp } from "./chatFormat";
import { useThreads } from "./useChatData";

function stripTokens(text: string): string {
  return text.replace(/\[\[exhibit:[^\]|]+\|([^\]]+)\]\]/g, "$1").replace(/\[\[exhibit:[^\]]+\]\]/g, "");
}

function ThreadRow({ thread }: { thread: AiThread }) {
  return (
    <li className="chat-list-item">
      <NavLink to={`/chat/${thread.id}`} className={({ isActive }) => `chat-list-link${isActive ? " active" : ""}${thread.unread ? " unread" : ""}`}>
        <span className="chat-list-main">
          <span className="chat-list-title">
            {thread.pinned ? <span className="chat-pin" aria-label="Pinned" /> : null}
            {thread.title}
          </span>
          <span className="chat-list-snippet">{thread.snippet ? stripTokens(thread.snippet) : "No messages yet"}</span>
        </span>
        <span className="chat-list-side">
          <span className="chat-list-stamp">{listStamp(new Date(thread.lastMessageAt))}</span>
          {thread.pendingRunId ? (
            <span className="chat-spinner" aria-label="Working" />
          ) : thread.openAskCount > 0 ? (
            <span className="chat-list-badge" aria-label={`${thread.openAskCount} waiting for you`}>
              {thread.openAskCount}
            </span>
          ) : thread.unread ? (
            <span className="chat-unread-dot" aria-label="Unread" />
          ) : null}
        </span>
      </NavLink>
      <ThreadActions thread={thread} trigger="row" />
    </li>
  );
}

function Section({ title, threads }: { title: string; threads: AiThread[] }) {
  if (threads.length === 0) return null;
  return (
    <section className="chat-list-section">
      {title ? <h2 className="chat-list-heading">{title}</h2> : null}
      <ul className="chat-list">
        {threads.map((t) => (
          <ThreadRow key={t.id} thread={t} />
        ))}
      </ul>
    </section>
  );
}

export function ThreadList() {
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const threads = useThreads(false);
  const archived = useThreads(true);

  const q = query.trim().toLowerCase();
  const matches = (t: AiThread) => !q || t.title.toLowerCase().includes(q) || (t.snippet ?? "").toLowerCase().includes(q);
  const all = (threads.data ?? []).filter(matches);
  const pinned = all.filter((t) => t.pinned);
  const needsYou = all.filter((t) => !t.pinned && t.openAskCount > 0);
  const rest = all.filter((t) => !t.pinned && t.openAskCount === 0);
  const archivedList = (archived.data ?? []).filter(matches);

  return (
    <div className="chat-list-pane">
      <header className="chat-header chat-list-header">
        <div className="chat-header-text">
          <p className="chat-eyebrow">Congress</p>
          <h1 className="chat-title chat-title--large">Chats</h1>
        </div>
        <Link to="/chat/new" className="chat-new" aria-label="New chat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>New</span>
        </Link>
      </header>
      <div className="chat-list-scroll">
        {(threads.data?.length ?? 0) > 4 || q ? (
          <input className="chat-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" aria-label="Search chats" />
        ) : null}
        {threads.isLoading ? <p className="chat-loading">Loading —</p> : null}
        {threads.isError ? <p className="chat-loading">Couldn't load chats.</p> : null}
        {threads.isSuccess && threads.data.length === 0 ? (
          <div className="chat-list-empty">
            <p>No chats yet.</p>
            <Link to="/chat/new" className="chat-inline-action">
              Start one
            </Link>
          </div>
        ) : null}
        {q && all.length === 0 && threads.isSuccess && threads.data.length > 0 ? <p className="chat-loading">No matches.</p> : null}
        <Section title="Pinned" threads={pinned} />
        <Section title="Needs you" threads={needsYou} />
        <Section title={pinned.length || needsYou.length ? "Recent" : ""} threads={rest} />
        {(archived.data?.length ?? 0) > 0 ? (
          <div className="chat-archived">
            <button type="button" className="chat-archived-toggle" onClick={() => setShowArchived((s) => !s)} aria-expanded={showArchived}>
              Archived ({archived.data?.length})
            </button>
            {showArchived ? (
              <ul className="chat-list">
                {archivedList.map((t) => (
                  <ThreadRow key={t.id} thread={t} />
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
