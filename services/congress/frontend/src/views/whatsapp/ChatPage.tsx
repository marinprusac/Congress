import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { StackLink } from "@congress/congress-ui";
import { fetchChat, fetchChatRecord, fetchMessages, markReadLocally, ReaderUnavailableError, type Message } from "@/views/whatsapp/api";
import { chatTitle, jidLabel, withDayBreaks } from "@/views/whatsapp/format";
import { MessageBubble } from "@/views/whatsapp/MessageBubble";
import { useChatPath } from "@/views/whatsapp/ChatsPage";
import "./whatsapp.css";

export function ChatPage() {
  const jid = decodeURIComponent(useParams<{ jid: string }>().jid ?? "");
  const [params] = useSearchParams();
  const at = params.get("at") ?? "";
  const highlight = params.get("msg") ?? "";
  const chatPath = useChatPath();

  const chat = useQuery({ queryKey: ["chat", jid], queryFn: () => fetchChat(jid), enabled: jid !== "" });
  const messages = useInfiniteQuery({
    queryKey: ["messages", jid, at],
    queryFn: ({ pageParam }) => fetchMessages(jid, pageParam || undefined),
    initialPageParam: at,
    getNextPageParam: (last) => last.nextCursor || undefined,
    // Following the live end of the chat; a jump into history stays put.
    refetchInterval: at ? false : 15_000,
    retry: (count, err) => !(err instanceof ReaderUnavailableError) && count < 2,
    enabled: jid !== "",
  });

  // Start at the bottom (or the searched-for message); keep position when older pages load above.
  const pages = messages.data?.pages.length ?? 0;
  const prevHeight = useRef<number | null>(null);
  const didInitialScroll = useRef(false);
  useLayoutEffect(() => {
    if (!pages) return;
    const root = document.scrollingElement ?? document.documentElement;
    if (!didInitialScroll.current) {
      didInitialScroll.current = true;
      const target = highlight ? document.getElementById(`m-${highlight}`) : null;
      if (target) target.scrollIntoView({ block: "center" });
      else root.scrollTop = root.scrollHeight;
    } else if (prevHeight.current !== null) {
      root.scrollTop += root.scrollHeight - prevHeight.current;
      prevHeight.current = null;
    }
  }, [pages, highlight]);
  useEffect(() => {
    didInitialScroll.current = false;
  }, [jid, at]);

  const loadOlder = () => {
    prevHeight.current = (document.scrollingElement ?? document.documentElement).scrollHeight;
    void messages.fetchNextPage();
  };

  const record = useQuery({ queryKey: ["chat-record", jid], queryFn: () => fetchChatRecord(jid), enabled: jid !== "" });
  const title = chat.data ? chatTitle(chat.data) : jidLabel(jid);
  const all = messages.data?.pages.flatMap((p) => p.messages) ?? [];
  const firstUnread = useReadLocally(jid, at === "" ? all : [], chat.data?.markedUnread ?? false);
  const isGroup = chat.data?.isGroup ?? jid.endsWith("@g.us");

  return (
    <article>
      <header className="mb-3 border-b border-dust pb-3">
        <h2 className="break-words font-display text-2xl text-ink">{title}</h2>
        {!isGroup && chat.data?.name && <p className="font-mono text-xs text-dust">{jidLabel(jid)}</p>}
        {record.data?.id && (
          <StackLink to={`/e/${record.data.id}`} className="font-mono text-xs uppercase tracking-wide text-accent">
            Open record
          </StackLink>
        )}
      </header>

      {messages.isLoading ? (
        <p className="font-mono text-sm text-dust">Loading —</p>
      ) : messages.isError ? (
        <p className="font-mono text-sm text-alert">
          {messages.error instanceof ReaderUnavailableError ? "The WhatsApp reader isn't running." : "Failed to load messages."}
        </p>
      ) : all.length === 0 ? (
        <p className="font-mono text-sm text-dust">— No messages —</p>
      ) : (
        <>
          {messages.hasNextPage && (
            <button type="button" className="wa-more" onClick={loadOlder} disabled={messages.isFetchingNextPage}>
              {messages.isFetchingNextPage ? "Loading —" : "Older messages"}
            </button>
          )}
          <div className="wa-thread">
            {withDayBreaks(all).map(({ message, day }) => (
              <div key={message.id}>
                {day && <p className="wa-day">{day}</p>}
                {message.id === firstUnread && <p className="wa-unread-divider">Unread</p>}
                <MessageBubble message={message} showSender={isGroup} highlighted={message.id === highlight} />
              </div>
            ))}
          </div>
          {at && (
            <StackLink to={chatPath(jid)} replace className="wa-more">
              Jump to latest
            </StackLink>
          )}
        </>
      )}
      <p className="wa-readonly">Read-only · nothing here is sent to WhatsApp</p>
    </article>
  );
}

// Seeing the live end of a chat marks it read in Congress's own copy only (no
// read receipt: the sender and the phone see nothing). Returns the id of the
// first message that was unread when the chat opened, for a divider.
function useReadLocally(jid: string, loaded: Message[], markedUnread: boolean) {
  const queryClient = useQueryClient();
  const [divider, setDivider] = useState<{ jid: string; id: string } | null>(null);
  const seen = useRef("");

  const newest = loaded[0]; // pages are newest-first
  const oldestUnread = [...loaded].reverse().find((m) => m.unread)?.id ?? null;
  const pending = markedUnread || oldestUnread !== null;
  // Kept after the messages turn read, so the divider doesn't vanish on refetch.
  if (oldestUnread && divider?.jid !== jid) setDivider({ jid, id: oldestUnread });

  useEffect(() => {
    if (!pending || !newest) return;
    const mark = () => {
      if (document.visibilityState !== "visible" || seen.current === newest.id) return;
      seen.current = newest.id;
      markReadLocally(jid, newest.id)
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: ["chats"] });
          void queryClient.invalidateQueries({ queryKey: ["chat", jid] });
          void queryClient.invalidateQueries({ queryKey: ["messages", jid] });
        })
        .catch(() => {
          seen.current = "";
        });
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [jid, pending, newest, queryClient]);

  return divider?.jid === jid ? divider.id : null;
}
