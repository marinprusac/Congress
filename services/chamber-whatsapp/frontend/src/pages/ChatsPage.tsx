import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  ListEmptyState,
  ListErrorState,
  ListLoadingState,
  ListSearchInput,
  StackLink,
  resolveChamberPath,
  useShellHosted,
} from "@congress/congress-ui";
import { cursorAt, fetchChats, fetchStatus, ReaderUnavailableError, searchAll, type ChatSummary, type Message } from "@/lib/api";
import { chatTitle, listTime, previewText, senderLabel, statusNotice } from "@/lib/format";
import { Avatar } from "@/components/Avatar";

export function useChatPath() {
  const shellHosted = useShellHosted();
  return (jid: string, at?: Message) => {
    const base = resolveChamberPath(`/c/${encodeURIComponent(jid)}`, "whatsapp", shellHosted);
    return at ? `${base}?at=${encodeURIComponent(cursorAt(at.ts))}&msg=${encodeURIComponent(at.id)}` : base;
  };
}

function StatusBanner() {
  const status = useQuery({ queryKey: ["status"], queryFn: fetchStatus, refetchInterval: 60_000, retry: false });
  const notice = statusNotice(status.data ?? null, status.error instanceof ReaderUnavailableError);
  if (status.isLoading || !notice) return null;
  return <p className={`wa-notice ${notice.tone === "alert" ? "wa-notice-alert" : ""}`}>{notice.text}</p>;
}

function ChatRow({ chat }: { chat: ChatSummary }) {
  const chatPath = useChatPath();
  const title = chatTitle(chat);
  const who = chat.lastFromMe ? "You: " : chat.isGroup && chat.lastSender ? `${chat.lastSender}: ` : "";
  return (
    <li>
      <StackLink to={chatPath(chat.jid)} className="wa-chat-row">
        <Avatar name={title} group={chat.isGroup} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate font-display text-lg text-ink">{title}</span>
            <span className="shrink-0 font-mono text-xs text-dust">{listTime(chat.lastMessageAt)}</span>
          </span>
          <span className="block truncate font-mono text-sm text-slate">
            {who}
            {previewText(chat.lastText, chat.lastType, chat.lastRevoked)}
          </span>
        </span>
      </StackLink>
    </li>
  );
}

function useDebounced(value: string, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function SearchResults({ query }: { query: string }) {
  const chatPath = useChatPath();
  const results = useQuery({ queryKey: ["search", query], queryFn: () => searchAll(query) });
  if (results.isLoading) return <ListLoadingState />;
  if (results.isError || !results.data) return <ListErrorState label="WhatsApp" />;
  const { chats, messages } = results.data;
  if (chats.length === 0 && messages.length === 0) return <ListEmptyState label="messages" hasQuery />;
  return (
    <>
      {chats.length > 0 && (
        <ul className="mb-4">
          {chats.map((c) => (
            <ChatRow key={c.jid} chat={c} />
          ))}
        </ul>
      )}
      {messages.length > 0 && (
        <>
          <h3 className="wa-section-label">Messages</h3>
          <ul>
            {messages.map((m) => (
              <li key={`${m.chatJid}/${m.id}`}>
                <StackLink to={chatPath(m.chatJid, m)} className="wa-chat-row">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-display text-base text-ink">{chatTitle({ jid: m.chatJid, name: m.chatName ?? "" })}</span>
                      <span className="shrink-0 font-mono text-xs text-dust">{listTime(m.ts)}</span>
                    </span>
                    <span className="line-clamp-2 font-mono text-sm text-slate">
                      {senderLabel(m)}: {m.text}
                    </span>
                  </span>
                </StackLink>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

export function ChatsPage() {
  const [search, setSearch] = useState("");
  const query = useDebounced(search.trim(), 250);
  const chats = useInfiniteQuery({
    queryKey: ["chats"],
    queryFn: ({ pageParam }) => fetchChats(pageParam || undefined),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor || undefined,
    refetchInterval: 30_000,
    retry: (count, err) => !(err instanceof ReaderUnavailableError) && count < 2,
  });
  const rows = chats.data?.pages.flatMap((p) => p.chats) ?? [];

  return (
    <div>
      <StatusBanner />
      <ListSearchInput value={search} onChange={setSearch} placeholder="Search chats and messages" />
      {query ? (
        <SearchResults query={query} />
      ) : chats.isLoading ? (
        <ListLoadingState />
      ) : chats.isError ? (
        chats.error instanceof ReaderUnavailableError ? null : <ListErrorState label="WhatsApp" />
      ) : rows.length === 0 ? (
        <ListEmptyState label="chats" hasQuery={false} />
      ) : (
        <>
          <ul>
            {rows.map((c) => (
              <ChatRow key={c.jid} chat={c} />
            ))}
          </ul>
          {chats.hasNextPage && (
            <button type="button" className="wa-more" onClick={() => chats.fetchNextPage()} disabled={chats.isFetchingNextPage}>
              {chats.isFetchingNextPage ? "Loading —" : "Older chats"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
