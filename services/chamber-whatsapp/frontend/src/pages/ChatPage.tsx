import { useEffect, useLayoutEffect, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { StackLink } from "@congress/congress-ui";
import { fetchChat, fetchMessages, ReaderUnavailableError } from "@/lib/api";
import { chatTitle, jidLabel, withDayBreaks } from "@/lib/format";
import { MessageBubble } from "@/components/MessageBubble";
import { useChatPath } from "@/pages/ChatsPage";

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

  const title = chat.data ? chatTitle(chat.data) : jidLabel(jid);
  const all = messages.data?.pages.flatMap((p) => p.messages) ?? [];
  const isGroup = chat.data?.isGroup ?? jid.endsWith("@g.us");

  return (
    <article>
      <header className="mb-3 border-b border-dust pb-3">
        <h2 className="break-words font-display text-2xl text-ink">{title}</h2>
        {!isGroup && chat.data?.name && <p className="font-mono text-xs text-dust">{jidLabel(jid)}</p>}
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
