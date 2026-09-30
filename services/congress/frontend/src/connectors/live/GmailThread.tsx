import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { googleConnectHref } from "@congress/congress-ui";
import { fetchLive } from "@/lib/recordsApi";
import { EmailHtml } from "./EmailHtml";
import type { LiveProps } from "./index";

// The connector's thread detail (services/congress/src/connectors/gmail/detail.ts).
interface Attachment {
  partId: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string | null;
}
interface Message {
  messageId: string;
  from: { name: string | null; email: string | null };
  to: string | null;
  cc: string | null;
  date: string;
  unread: boolean;
  text: string;
  html: string | null;
  attachments: Attachment[];
}
interface Thread {
  key: string;
  accountEmail: string;
  gmailUrl: string;
  messages: Message[];
}

const formatDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function MessageCard({ message, expanded, onToggle }: { message: Message; expanded: boolean; onToggle: () => void }) {
  const sender = message.from.name ?? message.from.email ?? "(unknown sender)";
  return (
    <li className="border-t border-dust py-3 first:border-t-0 first:pt-0">
      <button type="button" onClick={onToggle} className="flex w-full items-baseline justify-between gap-3 text-left">
        <span className="min-w-0">
          <span className={`block truncate font-display text-lg ${message.unread ? "text-ink" : "text-slate"}`}>{sender}</span>
          {expanded && message.from.name && message.from.email && <span className="block truncate font-mono text-xs text-dust">{message.from.email}</span>}
        </span>
        <span className="shrink-0 font-mono text-xs text-dust">{formatDate(message.date)}</span>
      </button>

      {!expanded && <p className="mt-1 line-clamp-2 font-mono text-sm text-dust">{message.text.slice(0, 300)}</p>}

      {expanded && (
        <div className="mt-2 space-y-3">
          <dl className="font-mono text-xs text-dust">
            {message.to && (
              <div className="flex gap-2">
                <dt className="shrink-0">To</dt>
                <dd className="min-w-0 break-words">{message.to}</dd>
              </div>
            )}
            {message.cc && (
              <div className="flex gap-2">
                <dt className="shrink-0">Cc</dt>
                <dd className="min-w-0 break-words">{message.cc}</dd>
              </div>
            )}
          </dl>
          {message.html ? <EmailHtml html={message.html} /> : <p className="whitespace-pre-wrap break-words font-body text-base text-ink">{message.text}</p>}
          {message.attachments.some((a) => a.url) && (
            <ul className="flex flex-wrap gap-2">
              {message.attachments.map((a) =>
                a.url ? (
                  <li key={a.partId} className="min-w-0 max-w-full">
                    <a href={a.url} className="tap-target block max-w-full truncate border border-dust px-2 py-1 font-mono text-xs text-accent hover:underline">
                      {a.filename} · {formatSize(a.size)}
                    </a>
                  </li>
                ) : null
              )}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

// An Email record's conversation, read live from Gmail. Opening it marks it read, once per visit.
export function GmailThread({ recordId, binding, runAction }: LiveProps) {
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const query = useQuery({ queryKey: ["record", recordId, "live"], queryFn: () => fetchLive<Thread>(recordId), retry: 1 });
  const marked = useRef<string | null>(null);
  const canMarkRead = binding.actions.some((a) => a.id === "mark_read");
  useEffect(() => {
    if (!canMarkRead || !query.data || marked.current === recordId) return;
    marked.current = recordId;
    runAction("mark_read");
  }, [canMarkRead, query.data, recordId, runAction]);

  if (query.isLoading) return <p className="font-mono text-sm text-dust">Loading the conversation —</p>;
  if (query.isError || !query.data) {
    return (
      <p className="font-mono text-sm text-alert">
        Couldn't load it from Gmail{query.error instanceof Error ? `: ${query.error.message}` : ""}.{" "}
        <a href={googleConnectHref({ returnTo: `/e/${recordId}` })} className="uppercase text-accent hover:underline">
          Reconnect
        </a>
      </p>
    );
  }
  const thread = query.data;
  const last = thread.messages.length - 1;
  // The latest message and unread ones start open; tapping toggles.
  const isExpanded = (m: Message, i: number) => toggled[m.messageId] ?? (i === last || m.unread);
  return (
    <div className="min-w-0">
      <ul>
        {thread.messages.map((m, i) => (
          <MessageCard key={m.messageId} message={m} expanded={isExpanded(m, i)} onToggle={() => setToggled((t) => ({ ...t, [m.messageId]: !isExpanded(m, i) }))} />
        ))}
      </ul>
      <p className="mt-3 font-mono text-xs text-dust">
        {thread.accountEmail} ·{" "}
        <a href={thread.gmailUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
          Open in Gmail ↗
        </a>
      </p>
    </div>
  );
}
