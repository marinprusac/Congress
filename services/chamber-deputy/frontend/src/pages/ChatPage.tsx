import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormSubmitButton, useShellHosted, resolveChamberPath } from "@congress/congress-ui";
import { useNavigate } from "react-router-dom";
import { fetchMessages, postChatMessage, clearChatThread } from "@/lib/api";
import type { Message } from "../../../src/types";

// Mirrors DirectivesListPage's own chat-toggle icon, in the same leading
// position relative to that page's primary input (the search bar there,
// the message box here) - a true toggle needs the same control in the same
// spot on both sides, not a button in one corner to get in and a
// differently-placed one somewhere else to get back out.
function DirectivesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="1.1em" height="1.1em">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

// Deliberately a plain request/response exchange, not a live-streaming
// interface - the POST blocks on the queued headless run itself (see
// chat.ts/jobQueue.ts), which matches the "terse, transactional, not a chat
// companion" framing (docs/deputy-chamber-plan.md §1) better than a
// typing-indicator UI would. The sent message still shows up right away
// though, via an optimistic cache write in onMutate below - the user
// shouldn't stare at an unchanged transcript for however long the run takes.
//
// Deputy keeps no history beyond the current thread (see chat.ts's
// clearThread) - there's never more than one session's worth of messages to
// show, so there's no session-divider rendering here any more.
export function ChatPage() {
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const messagesQuery = useQuery({ queryKey: ["messages"], queryFn: fetchMessages });

  const mutation = useMutation({
    mutationFn: (input: { text: string }) => postChatMessage(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["messages"] });
      const previous = queryClient.getQueryData<Message[]>(["messages"]);
      const optimistic: Message = {
        id: -Date.now(),
        sessionId: previous?.at(-1)?.sessionId ?? "pending",
        role: "user",
        text: input.text,
        createdAt: new Date().toISOString(),
      };
      queryClient.setQueryData<Message[]>(["messages"], (old) => [...(old ?? []), optimistic]);
      return { previous };
    },
    onError: (_err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(["messages"], context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
    },
  });

  const clearMutation = useMutation({
    mutationFn: clearChatThread,
    onSuccess: () => queryClient.setQueryData<Message[]>(["messages"], []),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messagesQuery.data]);

  function send() {
    const trimmed = text.trim();
    if (!trimmed || mutation.isPending) return;
    setText("");
    mutation.mutate({ text: trimmed });
  }

  const messages: Message[] = messagesQuery.data ?? [];
  // While a send is still in flight the input has already been cleared
  // (see send() below) - keep showing Send/"…" through that window rather
  // than flipping to Clear, so a tap there can't wipe the thread out from
  // under a reply that's about to land.
  const showClear = !text.trim() && !mutation.isPending;

  return (
    <section className="mx-auto flex h-full w-full max-w-6xl flex-col">
      <div className="flex shrink-0 items-center justify-center px-4 pt-3 pb-2 sm:px-6 sm:pt-5">
        <h2 className="font-display text-2xl text-ink sm:text-3xl">Chat</h2>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 sm:px-6">
        {messagesQuery.isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
        {!messagesQuery.isLoading && messages.length === 0 && <p className="font-mono text-sm text-dust">— No messages yet — ask Deputy something —</p>}
        {messages.map((message) => (
          <div
            key={message.id}
            className={message.role === "user" ? "ml-auto max-w-[85%] border border-dust bg-parchment px-3 py-2" : "mr-auto max-w-[85%] border border-accent/40 bg-parchment px-3 py-2"}
          >
            <p className="whitespace-pre-wrap font-mono text-sm text-ink">{message.text}</p>
          </div>
        ))}
        {mutation.isPending && <p className="font-mono text-xs text-dust">Deputy is working —</p>}
        <div ref={bottomRef} />
      </div>

      {mutation.isError && <p className="shrink-0 px-4 pt-2 font-mono text-xs text-alert sm:px-6">{(mutation.error as Error).message}</p>}
      {clearMutation.isError && <p className="shrink-0 px-4 pt-2 font-mono text-xs text-alert sm:px-6">{(clearMutation.error as Error).message}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex shrink-0 gap-2 px-4 py-3 sm:px-6 sm:py-4"
      >
        <button
          type="button"
          onClick={() => navigate(resolveChamberPath("/", "deputy", shellHosted))}
          aria-label="Directives"
          title="Directives"
          className="tap-target flex w-11 shrink-0 items-center justify-center border border-dust text-ink hover:border-accent hover:text-accent"
        >
          <DirectivesIcon />
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message Deputy —"
          className="min-w-0 flex-1 border border-dust bg-parchment px-3 py-2 font-mono text-base text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
        {showClear ? (
          <button
            type="button"
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending || messages.length === 0}
            className="border border-alert px-4 py-2 font-mono text-xs uppercase tracking-wide text-alert hover:bg-alert hover:text-parchment disabled:opacity-50"
          >
            {clearMutation.isPending ? "…" : "Clear"}
          </button>
        ) : (
          <FormSubmitButton disabled={mutation.isPending}>{mutation.isPending ? "…" : "Send"}</FormSubmitButton>
        )}
      </form>
    </section>
  );
}
