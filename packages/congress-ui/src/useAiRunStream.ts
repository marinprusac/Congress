import { useEffect, useState } from "react";
import type { AiRunKind, AiRunMeta, AiSettings } from "@congress/shared-types";
import { parseJsonResponse } from "./api.js";

export interface AiToolCall {
  toolName: string;
  input: unknown;
  output?: unknown;
  error?: string | null;
  done: boolean;
}

export interface AiRunStreamState {
  active: boolean;
  kind: AiRunKind | null;
  // The caller's own metadata for this run (e.g. { chamber: "deputy",
  // directiveId }), echoed back by Congress - how a Chamber recognizes its
  // own runs among everyone else's.
  meta: AiRunMeta;
  toolCalls: AiToolCall[];
  // The latest assistant turn's text, if any arrived yet - a live caption,
  // not the final reply (the persisted result is the source of truth).
  text: string | null;
}

const IDLE_STATE: AiRunStreamState = { active: false, kind: null, meta: {}, toolCalls: [], text: null };

// Subscribes to Congress's GET /congress/ai/runs/stream (server-sent events)
// and turns it into the current AI run's live state. There's at most one run
// globally (Congress's job queue is concurrency-1), so this is one shared
// "what's happening right now" view - callers filter by kind/meta
// themselves. EventSource reconnects on its own, and the server replays the
// current run's full event log (or "idle") to every (re)connected client.
export function useAiRunStream(): AiRunStreamState {
  const [state, setState] = useState<AiRunStreamState>(IDLE_STATE);

  useEffect(() => {
    const source = new EventSource("/congress/ai/runs/stream");

    source.addEventListener("idle", () => setState(IDLE_STATE));

    source.addEventListener("run_started", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { kind: AiRunKind; meta: AiRunMeta };
      setState({ active: true, kind: data.kind, meta: data.meta ?? {}, toolCalls: [], text: null });
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

export const aiSettingsQueryKey = ["congress", "ai", "settings"] as const;

export function fetchAiSettings(): Promise<AiSettings> {
  return fetch("/congress/ai/settings").then((res) => parseJsonResponse<AiSettings>(res));
}
