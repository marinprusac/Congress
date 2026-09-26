import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AiMessage } from "@congress/shared-types";
import { ChamberHeader, CapitolMark, FormSubmitButton, useAiRunStream, fetchAiSettings, aiSettingsQueryKey, useAppliedTheme } from "@congress/congress-ui";
import { aiMessagesQueryKey, clearAiChatThread, fetchAiMessages, postAiChatMessage } from "@/lib/aiApi";

// Congress's own AI chat (moved in from the Deputy Chamber). The POST blocks
// on the queued headless run itself - a plain request/response exchange -
// while useAiRunStream surfaces live tool-call progress so the wait isn't a
// static caption. The sent message shows up right away via an optimistic
// cache write, and is persisted server-side before the run even starts, so
// it survives a refresh mid-run. The chat keeps no history beyond the
// current thread; Clear (shown in place of Send when the input is empty)
// wipes it.
export function ChatPage() {
  useAppliedTheme();
  const runStream = useAiRunStream();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const messagesQuery = useQuery({ queryKey: aiMessagesQueryKey, queryFn: fetchAiMessages });
  // A paused AI still replies (the pause reason comes back as the reply
  // text), but that's easy to misread as an unhelpful answer - so it's also
  // a standing banner.
  const settingsQuery = useQuery({ queryKey: aiSettingsQueryKey, queryFn: fetchAiSettings });
  const paused = settingsQuery.data?.paused ?? false;

  const mutation = useMutation({
    mutationFn: (input: { text: string }) => postAiChatMessage(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: aiMessagesQueryKey });
      const previous = queryClient.getQueryData<AiMessage[]>(aiMessagesQueryKey);
      const optimistic: AiMessage = {
        id: -Date.now(),
        sessionId: previous?.at(-1)?.sessionId ?? "pending",
        role: "user",
        text: input.text,
        createdAt: new Date().toISOString(),
      };
      queryClient.setQueryData<AiMessage[]>(aiMessagesQueryKey, (old) => [...(old ?? []), optimistic]);
      return { previous };
    },
    onError: (_err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(aiMessagesQueryKey, context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: aiMessagesQueryKey });
      queryClient.invalidateQueries({ queryKey: aiSettingsQueryKey });
    },
  });

  const clearMutation = useMutation({
    mutationFn: clearAiChatThread,
    onSuccess: () => queryClient.setQueryData<AiMessage[]>(aiMessagesQueryKey, []),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messagesQuery.data]);

  // A message typed into Home's "Ask Congress" composer arrives as
  // navigation state - send it once, then drop the state so a refresh or a
  // back/forward visit doesn't send it again.
  const location = useLocation();
  const navigate = useNavigate();
  const sentFromHomeRef = useRef(false);
  useEffect(() => {
    const send = (location.state as { send?: string } | null)?.send;
    if (!send || sentFromHomeRef.current) return;
    sentFromHomeRef.current = true;
    navigate(location.pathname, { replace: true, state: null });
    mutation.mutate({ text: send });
  }, [location.state, location.pathname, navigate, mutation]);

  function send() {
    const trimmed = text.trim();
    if (!trimmed || mutation.isPending) return;
    setText("");
    mutation.mutate({ text: trimmed });
  }

  const messages: AiMessage[] = messagesQuery.data ?? [];
  // Keep Send/"…" through the in-flight window (the input is already
  // cleared by then) so a tap can't wipe the thread under a pending reply.
  const showClear = !text.trim() && !mutation.isPending;

  return (
    <div className="chamber-shell chamber-shell--canvas">
      <ChamberHeader icon={<CapitolMark className="h-6 w-6 text-ink" />} title="Chat" titleHref="" />
      <main className="chamber-main chamber-main--canvas">
        <section className="mx-auto flex h-full w-full max-w-6xl flex-col">
          {paused && (
            <div className="mx-4 mb-2 shrink-0 border border-alert px-3 py-2 font-mono text-sm text-alert sm:mx-6">
              AI is paused{settingsQuery.data?.pausedReason ? ` — ${settingsQuery.data.pausedReason}` : "."}{" "}
              <Link to="/settings?from=ai" className="underline">
                Resume in Settings
              </Link>
            </div>
          )}

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 sm:px-6">
            {messagesQuery.isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
            {!messagesQuery.isLoading && messages.length === 0 && <p className="font-mono text-sm text-dust">— No messages yet —</p>}
            {messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === "user"
                    ? "ml-auto max-w-[85%] border border-dust bg-parchment px-3 py-2"
                    : "mr-auto max-w-[85%] border border-accent/40 bg-parchment px-3 py-2"
                }
              >
                <p className="whitespace-pre-wrap font-mono text-sm text-ink">{message.text}</p>
              </div>
            ))}
            {mutation.isPending && (
              <div className="font-mono text-xs text-dust">
                {runStream.kind === "chat" && runStream.toolCalls.length > 0 ? (
                  <ul className="space-y-0.5">
                    {runStream.toolCalls.map((call, index) => (
                      <li key={index}>
                        {call.done ? (call.error ? "✗" : "✓") : "…"} {call.toolName}
                      </li>
                    ))}
                  </ul>
                ) : (
                  "Working —"
                )}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {mutation.isError && <p className="shrink-0 px-4 pt-2 font-mono text-xs text-alert sm:px-6">{(mutation.error as Error).message}</p>}
          {clearMutation.isError && (
            <p className="shrink-0 px-4 pt-2 font-mono text-xs text-alert sm:px-6">{(clearMutation.error as Error).message}</p>
          )}

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
              placeholder="Ask Congress —"
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
      </main>
    </div>
  );
}
