import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";

export interface DeputyToolCall {
  toolName: string;
  input: unknown;
  output?: unknown;
  error?: string | null;
  done: boolean;
}

export interface DeputyRunStreamState {
  active: boolean;
  kind: "chat" | "directive" | null;
  directiveId: number | null;
  toolCalls: DeputyToolCall[];
  // The most recent assistant turn's own text, if any arrived yet - not the
  // accumulated transcript (a run may have several turns interleaved with
  // tool calls); good enough for a live "what's it doing" caption, the
  // persisted chat/directive result is the source of truth for the final
  // reply either way.
  text: string | null;
}

const IDLE_STATE: DeputyRunStreamState = { active: false, kind: null, directiveId: null, toolCalls: [], text: null };

// Subscribes to chamber-deputy's GET /api/runs/stream (server-sent events)
// and turns it into the current run's live state - tool calls in flight,
// the latest assistant text, whether anything is running at all. There's at
// most one run globally (jobQueue.ts is concurrency-1), so this is a single
// shared "what's happening right now" view, not scoped to any one
// directive/chat - callers filter by `kind`/`directiveId` themselves (see
// ChatPage/DirectivesListPage/DirectiveViewPage). EventSource reconnects on
// its own if the connection drops; the server always replays the current
// run's full event log (or "idle") to a newly (re)connected client, so a
// reconnect naturally rebuilds the right state without any special-casing
// here.
export function useDeputyRunStream(): DeputyRunStreamState {
  const [state, setState] = useState<DeputyRunStreamState>(IDLE_STATE);

  useEffect(() => {
    const source = new EventSource(`${API_BASE}/runs/stream`);

    source.addEventListener("idle", () => setState(IDLE_STATE));

    source.addEventListener("run_started", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { kind: "chat" | "directive"; directiveId: number | null };
      setState({ active: true, kind: data.kind, directiveId: data.directiveId, toolCalls: [], text: null });
    });

    source.addEventListener("tool_start", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { toolName: string; input: unknown };
      setState((prev) => ({ ...prev, toolCalls: [...prev.toolCalls, { toolName: data.toolName, input: data.input, done: false }] }));
    });

    source.addEventListener("tool_result", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { toolName: string; output: unknown; error: string | null };
      setState((prev) => {
        let index = -1;
        for (let i = prev.toolCalls.length - 1; i >= 0; i--) {
          if (prev.toolCalls[i]!.toolName === data.toolName && !prev.toolCalls[i]!.done) {
            index = i;
            break;
          }
        }
        if (index === -1) {
          return { ...prev, toolCalls: [...prev.toolCalls, { toolName: data.toolName, input: null, output: data.output, error: data.error, done: true }] };
        }
        const toolCalls = [...prev.toolCalls];
        toolCalls[index] = { ...toolCalls[index]!, output: data.output, error: data.error, done: true };
        return { ...prev, toolCalls };
      });
    });

    source.addEventListener("assistant_text", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { text: string };
      setState((prev) => ({ ...prev, text: data.text }));
    });

    source.addEventListener("run_finished", () => {
      setState((prev) => ({ ...prev, active: false }));
    });

    return () => source.close();
  }, []);

  return state;
}
