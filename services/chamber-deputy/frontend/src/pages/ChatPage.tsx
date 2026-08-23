import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormSubmitButton } from "@congress/congress-ui";
import { fetchMessages, postChatMessage } from "@/lib/api";
import type { Message } from "../../../src/types";

// Deliberately a plain request/response exchange, not a live-streaming
// interface - the POST blocks on the queued headless run itself (see
// chat.ts/jobQueue.ts), which matches the "terse, transactional, not a chat
// companion" framing (docs/deputy-chamber-plan.md §1) better than a
// typing-indicator UI would. The sent message still shows up right away
// though, via an optimistic cache write in onMutate below - the user
// shouldn't stare at an unchanged transcript for however long the run takes.
export function ChatPage() {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [forceNewThread, setForceNewThread] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const messagesQuery = useQuery({ queryKey: ["messages"], queryFn: fetchMessages });

  const mutation = useMutation({
    mutationFn: (input: { text: string; newThread: boolean }) => postChatMessage(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["messages"] });
      const previous = queryClient.getQueryData<Message[]>(["messages"]);
      const optimistic: Message = {
        id: -Date.now(),
        sessionId: input.newThread ? `pending-${Date.now()}` : (previous?.at(-1)?.sessionId ?? "pending"),
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messagesQuery.data]);

  function send() {
    const trimmed = text.trim();
    if (!trimmed || mutation.isPending) return;
    setText("");
    mutation.mutate({ text: trimmed, newThread: forceNewThread });
    setForceNewThread(false);
  }

  const messages: Message[] = messagesQuery.data ?? [];
  let previousSessionId: string | null = null;

  return (
    <section className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between px-4 pt-3 pb-2 sm:px-6 sm:pt-5">
        <h2 className="font-display text-2xl text-ink sm:text-3xl">Chat</h2>
        <button
          type="button"
          onClick={() => setForceNewThread(true)}
          disabled={forceNewThread}
          className="tap-target font-mono text-xs uppercase tracking-wide text-accent hover:underline disabled:opacity-50"
        >
          New thread
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 sm:px-6">
        {messagesQuery.isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
        {!messagesQuery.isLoading && messages.length === 0 && <p className="font-mono text-sm text-dust">— No messages yet — ask Deputy something —</p>}
        {messages.map((message) => {
          const isNewSession = previousSessionId !== null && message.sessionId !== previousSessionId;
          previousSessionId = message.sessionId;
          return (
            <div key={message.id}>
              {isNewSession && <div className="my-3 border-t border-dashed border-dust" />}
              <div className={message.role === "user" ? "ml-auto max-w-[85%] border border-dust bg-parchment px-3 py-2" : "mr-auto max-w-[85%] border border-accent/40 bg-parchment px-3 py-2"}>
                <p className="whitespace-pre-wrap font-mono text-sm text-ink">{message.text}</p>
              </div>
            </div>
          );
        })}
        {mutation.isPending && <p className="font-mono text-xs text-dust">Deputy is working —</p>}
        <div ref={bottomRef} />
      </div>

      {forceNewThread && <p className="shrink-0 px-4 pt-2 font-mono text-xs text-dust sm:px-6">Next message starts a new thread —</p>}
      {mutation.isError && <p className="shrink-0 px-4 pt-2 font-mono text-xs text-alert sm:px-6">{(mutation.error as Error).message}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex shrink-0 gap-2 px-4 py-3 sm:px-6 sm:py-4"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message Deputy —"
          className="min-w-0 flex-1 border border-dust bg-parchment px-3 py-2 font-mono text-base text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
        <FormSubmitButton disabled={mutation.isPending || !text.trim()}>{mutation.isPending ? "…" : "Send"}</FormSubmitButton>
      </form>
    </section>
  );
}
