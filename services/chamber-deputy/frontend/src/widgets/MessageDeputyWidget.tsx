import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { useShellHosted, resolveChamberPath } from "@congress/congress-ui";
import { postChatMessage } from "@/lib/api";

// A quick-send box, not a list - so this doesn't use WidgetPreviewShell's
// label/add-link/loading-list chrome (see docs/deputy-chamber-plan.md §12).
// Sends the message immediately (same POST the chat page itself uses) and
// then navigates to the chat page to show the exchange, rather than trying
// to render a reply inline in 2x1 cells.
export function MessageDeputyWidget() {
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const [text, setText] = useState("");

  const mutation = useMutation({
    mutationFn: () => postChatMessage({ text: text.trim(), newThread: false }),
    onSuccess: () => {
      navigate(resolveChamberPath("/chat", "deputy", shellHosted));
    },
  });

  function send() {
    if (!text.trim() || mutation.isPending) return;
    mutation.mutate();
  }

  return (
    <div className="flex h-full flex-col justify-center gap-2 bg-parchment p-3 text-ink">
      <p className="font-mono text-[10px] uppercase tracking-widest text-dust">Message Deputy</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex gap-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask Deputy —"
          className="min-w-0 flex-1 border border-dust bg-parchment px-2 py-1.5 font-mono text-sm text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
        <button
          type="submit"
          disabled={mutation.isPending || !text.trim()}
          className="shrink-0 border border-accent px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-accent hover:bg-accent hover:text-parchment disabled:opacity-50"
        >
          {mutation.isPending ? "…" : "Ask"}
        </button>
      </form>
      {mutation.isError && <p className="font-mono text-xs text-alert">{(mutation.error as Error).message}</p>}
    </div>
  );
}
