import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@congress/congress-ui";
import { fetchMessages, postChatMessage } from "@/lib/api";
import type { Message } from "../../../src/types";

// Deliberately a plain request/response exchange, not a live-streaming
// interface - the POST blocks on the queued headless run itself (see
// chat.ts/jobQueue.ts), which matches the "terse, transactional, not a chat
// companion" framing (docs/deputy-chamber-plan.md §1) better than a
// typing-indicator UI would.
export function ChatPage() {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [forceNewThread, setForceNewThread] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const messagesQuery = useQuery({ queryKey: ["messages"], queryFn: fetchMessages });

  const mutation = useMutation({
    mutationFn: (input: { text: string; newThread: boolean }) => postChatMessage(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      setText("");
      setForceNewThread(false);
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messagesQuery.data]);

  function send() {
    if (!text.trim() || mutation.isPending) return;
    mutation.mutate({ text: text.trim(), newThread: forceNewThread });
  }

  const messages: Message[] = messagesQuery.data ?? [];
  let previousSessionId: string | null = null;

  return (
    <section>
      <div className="mb-4 flex items-center justify-between border-b border-dust pb-4">
        <PageHeader title="Chat" />
        <button
          type="button"
          onClick={() => setForceNewThread(true)}
          disabled={forceNewThread}
          className="tap-target -mt-6 font-mono text-xs uppercase tracking-wide text-accent hover:underline disabled:opacity-50"
        >
          New thread
        </button>
      </div>

      <div className="mb-4 max-h-[60vh] space-y-3 overflow-y-auto">
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

      {forceNewThread && <p className="mb-2 font-mono text-xs text-dust">Next message starts a new thread —</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex gap-2 border-t border-dust pt-3"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message Deputy —"
          className="flex-1 border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
        <button
          type="submit"
          disabled={mutation.isPending || !text.trim()}
          className="border border-accent px-4 py-2 font-mono text-xs uppercase tracking-wide text-accent hover:bg-accent hover:text-parchment disabled:opacity-50"
        >
          {mutation.isPending ? "…" : "Send"}
        </button>
      </form>
      {mutation.isError && <p className="mt-2 font-mono text-xs text-alert">{(mutation.error as Error).message}</p>}
    </section>
  );
}
