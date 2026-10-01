import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AiMessage, AiThread } from "@congress/shared-types";
import { ChatMarkdown, StackLink, aiSettingsQueryKey, fetchAiSettings, showToast, useAiStream } from "@congress/congress-ui";
import {
  aiThreadMessagesQueryKey,
  aiThreadQueryKey,
  aiThreadsQueryKey,
  cancelAiRun,
  createAiThread,
  endBuilderMode,
  endInternetMode,
  markAiThreadRead,
  postAiThreadMessage,
  retryAiThread,
} from "@/lib/aiApi";
import { Composer } from "./Composer";
import { MessageItem } from "./MessageItem";
import { useChatNavigation } from "./chatNav";
import { LiveActivity } from "./RunActivity";
import { ThreadActions } from "./ThreadActions";
import { layoutMarkers } from "./chatFormat";
import { useThread, useThreadLive, useThreadMessages, type MessagesData, type ThreadLiveState } from "./useChatData";
import { useStickToBottom } from "./useStickToBottom";
import { ChatBackButton, useChatNav } from "./chatMotion";

const SUGGESTIONS = ["What's on my plate today?", "Summarise my week so far", "What should I not forget this week?"];

function BackButton() {
  return <ChatBackButton />;
}

// While one of the owner's grants (builder mode, internet) lasts, with a way to end it early.
function GrantBanner({ thread, kind }: { thread: AiThread; kind: "builder" | "internet" }) {
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const end = useMutation({
    mutationFn: () => (kind === "internet" ? endInternetMode(thread.id) : endBuilderMode(thread.id)),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: aiThreadQueryKey(thread.id) }),
  });
  const untilIso = kind === "internet" ? thread.internetUntil : thread.builderUntil;
  const until = untilIso ? new Date(untilIso).getTime() : 0;
  if (until <= now) return null;
  const minutes = Math.max(1, Math.round((until - now) / 60_000));
  return (
    <div className="builder-banner" role="status">
      <span>{kind === "internet" ? "Internet access" : "Builder mode"} · {minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`} left</span>
      <button type="button" onClick={() => end.mutate()} disabled={end.isPending}>
        End
      </button>
    </div>
  );
}

function PausedBanner() {
  const settings = useQuery({ queryKey: aiSettingsQueryKey, queryFn: fetchAiSettings, staleTime: 30_000 });
  if (!settings.data?.paused) return null;
  return (
    <div className="chat-banner" role="status">
      <span>AI is paused{settings.data.pausedReason ? ` — ${settings.data.pausedReason}` : "."}</span>
      <StackLink to="/settings?from=ai">Settings</StackLink>
    </div>
  );
}

function LiveReply({ live }: { live: ThreadLiveState }) {
  const nav = useChatNavigation();
  if (live.phase === "idle") return null;
  if (live.phase === "queued") {
    return (
      <div className="chat-msg chat-msg--assistant chat-msg--live" aria-live="polite">
        <p className="chat-waiting">{live.position === 0 ? "Waiting for another run to finish —" : `Queued (${live.position + 1} ahead) —`}</p>
      </div>
    );
  }
  if (live.phase === "starting") {
    return (
      <div className="chat-msg chat-msg--assistant chat-msg--live" aria-live="polite">
        <p className="chat-thinking">
          <span className="chat-dots" aria-hidden="true" />
          Thinking
        </p>
      </div>
    );
  }
  const { run } = live;
  return (
    <div className="chat-msg chat-msg--assistant chat-msg--live" aria-live="polite" aria-busy={!run.finished}>
      <LiveActivity activity={run.activity} />
      {run.text ? (
        <ChatMarkdown text={run.text} streaming={!run.finished} className="chat-reply chat-reply--streaming" {...nav} />
      ) : !run.finished && run.activity.length === 0 ? (
        <p className="chat-thinking">
          <span className="chat-dots" aria-hidden="true" />
          Thinking
        </p>
      ) : null}
    </div>
  );
}

function EmptyThread({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="chat-empty">
      <p className="chat-empty-title">Ask Congress anything.</p>
      <p className="chat-empty-hint">It can read and change your notes, tasks, calendar and more. Type @ to point it at something specific.</p>
      <div className="chat-suggestions">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" className="chat-suggestion" onClick={() => onPick(s)}>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// Appends the owner's message to the first (newest) page right away.
function withOptimistic(data: MessagesData | undefined, message: AiMessage): MessagesData | undefined {
  if (!data) return { pages: [{ messages: [message], hasMore: false }], pageParams: [undefined] };
  const [first, ...rest] = data.pages;
  return { ...data, pages: [{ ...(first ?? { hasMore: false }), messages: [...(first?.messages ?? []), message] }, ...rest] };
}

function optimisticMessage(threadId: number, text: string): AiMessage {
  return {
    id: -Date.now(),
    threadId,
    role: "user",
    kind: "text",
    status: "ok",
    text,
    runId: null,
    run: null,
    payload: null,
    askState: null,
    urgency: null,
    deliverAt: null,
    expiresAt: null,
    createdAt: new Date().toISOString(),
  };
}

function Conversation({ threadId }: { threadId: number }) {
  const queryClient = useQueryClient();
  const chat = useChatNav();
  const thread = useThread(threadId);
  const messagesQuery = useThreadMessages(threadId);
  const { messages } = messagesQuery;
  const pendingRunId = thread.data?.pendingRunId ?? null;
  const live = useThreadLive(threadId, pendingRunId, messages, messagesQuery.isSuccess);
  const running = live.phase !== "idle" && !(live.phase === "running" && live.run.finished);
  const { connected } = useAiStream();
  const liveVersion = live.phase === "running" ? `${live.run.runId}:${live.run.activity.length}:${live.run.text.length}` : live.phase;
  const version = `${messages.at(-1)?.id ?? 0}:${liveVersion}`;
  const { scrollRef, contentRef, hasNew, scrollToBottom, preserveScroll } = useStickToBottom(String(threadId), version);
  const topRef = useRef<HTMLDivElement | null>(null);

  // Load older messages when the top comes into view.
  useEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && messagesQuery.hasNextPage && !messagesQuery.isFetchingNextPage) {
        void preserveScroll(() => messagesQuery.fetchNextPage());
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [messagesQuery, preserveScroll]);

  // Reading the thread clears its unread state.
  const unread = thread.data?.unread;
  useEffect(() => {
    if (!unread || document.visibilityState !== "visible") return;
    void markAiThreadRead(threadId).then(() => {
      queryClient.setQueryData<AiThread>(aiThreadQueryKey(threadId), (t) => (t ? { ...t, unread: false } : t));
      void queryClient.invalidateQueries({ queryKey: aiThreadsQueryKey });
    });
  }, [unread, threadId, queryClient]);

  const setPending = (runId: string | null) =>
    queryClient.setQueryData<AiThread>(aiThreadQueryKey(threadId), (t) => (t ? { ...t, pendingRunId: runId } : t));

  const send = useMutation({
    mutationFn: (text: string) => postAiThreadMessage(threadId, text),
    onMutate: async (text) => {
      await queryClient.cancelQueries({ queryKey: aiThreadMessagesQueryKey(threadId) });
      const previous = queryClient.getQueryData<MessagesData>(aiThreadMessagesQueryKey(threadId));
      queryClient.setQueryData(aiThreadMessagesQueryKey(threadId), withOptimistic(previous, optimisticMessage(threadId, text)));
      scrollToBottom();
      return { previous };
    },
    onSuccess: ({ runId }) => setPending(runId),
    onError: (err, _text, ctx) => {
      queryClient.setQueryData(aiThreadMessagesQueryKey(threadId), ctx?.previous);
      showToast(err instanceof Error ? err.message : "Couldn't send", "error");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: aiThreadQueryKey(threadId) });
      void queryClient.invalidateQueries({ queryKey: aiThreadsQueryKey });
    },
  });

  const stop = useMutation({ mutationFn: () => cancelAiRun(pendingRunId ?? (live.phase === "running" ? live.run.runId : "")) });
  const retry = useMutation({
    mutationFn: () => retryAiThread(threadId),
    onSuccess: ({ runId }) => setPending(runId),
    onError: (err) => showToast(err instanceof Error ? err.message : "Couldn't retry", "error"),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: aiThreadQueryKey(threadId) }),
  });

  if (thread.isError) {
    return (
      <div className="chat-thread">
        <header className="chat-header">
          <BackButton />
          <h1 className="chat-title">Chat not found</h1>
        </header>
        <div className="chat-empty">
          <p className="chat-empty-hint">It may have been deleted.</p>
          <StackLink to="/chat" className="chat-inline-action">
            All chats
          </StackLink>
        </div>
      </div>
    );
  }

  const last = messages.at(-1);
  const canRetry = !running && last?.role === "assistant" && last.status !== "ok";
  const markers = layoutMarkers(messages);

  return (
    <div className="chat-thread">
      <header className="chat-header">
        <BackButton />
        <div className="chat-header-text">
          <h1 className="chat-title">{thread.data?.title ?? " "}</h1>
          {!connected ? <p className="chat-subtitle">Reconnecting —</p> : running ? <p className="chat-subtitle">Working —</p> : null}
        </div>
        {thread.data ? <ThreadActions thread={thread.data} onDeleted={chat.back} /> : null}
      </header>
      <PausedBanner />
      {thread.data ? <GrantBanner thread={thread.data} kind="builder" /> : null}
      {thread.data ? <GrantBanner thread={thread.data} kind="internet" /> : null}
      <div className="chat-scroll" ref={scrollRef}>
        <div className="chat-log" ref={contentRef}>
          <div ref={topRef} className="chat-top-sentinel" />
          {messagesQuery.isFetchingNextPage ? <p className="chat-loading-older">Loading earlier messages —</p> : null}
          {messagesQuery.isLoading ? <p className="chat-loading">Loading —</p> : null}
          {markers.map(({ message, day, stamp }) => (
            // The owner's just-sent (optimistic, negative id) message rises in.
            <div key={message.id} className={message.id < 0 ? "chat-row motion-rise" : "chat-row"}>
              {day ? (
                <p className="chat-day">
                  <span>{day}</span>
                </p>
              ) : null}
              <MessageItem
                message={message}
                stamp={stamp}
                onRetry={canRetry && message === last ? () => retry.mutate() : undefined}
                retrying={retry.isPending}
              />
            </div>
          ))}
          <LiveReply live={live} />
        </div>
      </div>
      {hasNew ? (
        <button type="button" className="chat-jump" onClick={() => scrollToBottom(true)}>
          ↓ New
        </button>
      ) : null}
      <Composer
        draftKey={String(threadId)}
        running={running || send.isPending}
        onStop={() => stop.mutate()}
        stopping={stop.isPending}
        onSend={async (text) => {
          try {
            await send.mutateAsync(text);
            return true;
          } catch {
            return false;
          }
        }}
      />
    </div>
  );
}

// "New chat": nothing is created until the first message is sent.
function NewConversation() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const create = async (text: string) => {
    if (creating) return false;
    setCreating(true);
    try {
      const { thread, runId } = await createAiThread({ text });
      queryClient.setQueryData(aiThreadQueryKey(thread.id), { ...thread, pendingRunId: runId });
      // The run may already be over (an instant refusal); confirm with the server.
      void queryClient.invalidateQueries({ queryKey: aiThreadQueryKey(thread.id) });
      void queryClient.invalidateQueries({ queryKey: aiThreadsQueryKey });
      navigate(`/chat/${thread.id}`, { replace: true });
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't start the chat", "error");
      setCreating(false);
      return false;
    }
  };

  return (
    <div className="chat-thread">
      <header className="chat-header">
        <BackButton />
        <div className="chat-header-text">
          <h1 className="chat-title">New chat</h1>
        </div>
      </header>
      <PausedBanner />
      <div className="chat-scroll">
        <EmptyThread onPick={(text) => void create(text)} />
      </div>
      <Composer draftKey="new" running={creating} onSend={create} autoFocus />
    </div>
  );
}

export function ThreadView() {
  const { threadId } = useParams();
  if (threadId === "new") return <NewConversation />;
  const id = Number(threadId);
  if (!Number.isInteger(id) || id <= 0) return <NewConversation />;
  // Keyed so each thread gets fresh local state.
  return <Conversation key={id} threadId={id} />;
}
