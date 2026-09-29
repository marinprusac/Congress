import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ExhibitActionBar,
  ExhibitLinksLayout,
  getChamberIcon,
  googleConnectHref,
  navigateToExhibit,
  useShellHosted,
} from "@congress/congress-ui";
import type { MessageDetail } from "../../../src/types";
import { attachmentUrl, fetchThread, MailRequestError } from "@/lib/api";
import { EmailHtml } from "@/components/EmailHtml";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function MessageCard({ message, expanded, onToggle }: { message: MessageDetail; expanded: boolean; onToggle: () => void }) {
  const sender = message.from.name ?? message.from.email ?? "(unknown sender)";
  return (
    <li className="border-t border-dust py-3">
      <button type="button" onClick={onToggle} className="flex w-full items-baseline justify-between gap-3 text-left">
        <span className="min-w-0">
          <span className={`block truncate font-display text-lg ${message.unread ? "text-ink" : "text-slate"}`}>{sender}</span>
          {expanded && message.from.name && message.from.email && (
            <span className="block truncate font-mono text-xs text-dust">{message.from.email}</span>
          )}
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
          {message.html ? (
            <EmailHtml html={message.html} />
          ) : (
            <p className="whitespace-pre-wrap break-words font-body text-base text-ink">{message.text}</p>
          )}
          {message.attachments.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {message.attachments.map((a) =>
                a.attachmentId ? (
                  <li key={a.partId} className="min-w-0 max-w-full">
                    <a
                      href={attachmentUrl(message.accountId, message.messageId, a.attachmentId, a.filename, a.mimeType)}
                      className="tap-target block max-w-full truncate border border-dust px-2 py-1 font-mono text-xs text-accent hover:underline"
                    >
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

export function ThreadPage() {
  const params = useParams<{ accountId: string; threadId: string }>();
  const accountId = Number(params.accountId);
  const threadId = params.threadId ?? "";
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const query = useQuery({
    queryKey: ["thread", accountId, threadId],
    queryFn: () => fetchThread(accountId, threadId),
    enabled: Number.isInteger(accountId) && threadId !== "",
    retry: (count, err) => !(err instanceof MailRequestError) && count < 2,
  });

  if (!Number.isInteger(accountId) || !threadId) return <p className="font-mono text-sm text-alert">Invalid thread.</p>;
  if (query.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (query.isError || !query.data) {
    const err = query.error;
    if (err instanceof MailRequestError && (err.code === "access_not_granted" || err.code === "account_needs_reconnect")) {
      return (
        <p className="font-mono text-sm text-alert">
          {err.message}.{" "}
          <a href={googleConnectHref({ returnTo: `/mail/t/${accountId}/${threadId}` })} className="uppercase text-accent hover:underline">
            Connect
          </a>
        </p>
      );
    }
    return <p className="font-mono text-sm text-alert">{err instanceof MailRequestError && err.code === "not_found" ? "Thread not found." : "Failed to load the thread."}</p>;
  }

  const thread = query.data;
  const last = thread.messages.length - 1;
  // The latest message and unread ones start open; tapping toggles.
  const isExpanded = (m: MessageDetail, i: number) => toggled[m.messageId] ?? (i === last || m.unread);

  return (
    <article>
      <div className="mb-4 border-b border-dust pb-4">
        <h2 className="break-words font-display text-2xl text-ink">{thread.subject}</h2>
        <p className="mt-1 font-mono text-xs text-dust">
          {thread.accountEmail} · {thread.messages.length} {thread.messages.length === 1 ? "message" : "messages"}
        </p>
      </div>

      <ExhibitLinksLayout
        exhibitId={thread.exhibitId}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("mail", r, navigate, shellHosted)}
        editable
        actions={
          <ExhibitActionBar>
            <a href={thread.gmailUrl} target="_blank" rel="noreferrer" className="tap-target text-accent hover:underline">
              Open in Gmail
            </a>
          </ExhibitActionBar>
        }
      >
        <ul>
          {thread.messages.map((m, i) => (
            <MessageCard
              key={m.messageId}
              message={m}
              expanded={isExpanded(m, i)}
              onToggle={() => setToggled((t) => ({ ...t, [m.messageId]: !isExpanded(m, i) }))}
            />
          ))}
        </ul>
      </ExhibitLinksLayout>
    </article>
  );
}
