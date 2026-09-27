import type { AiRunKind, AiRunMeta, AiSettings } from "@congress/shared-types";
import { parseJsonResponse } from "./api.js";
import { useAiStream } from "./aiStream.js";

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
  // The caller's own metadata for this run, echoed back by Congress - how a
  // Chamber recognizes its own runs among everyone else's.
  meta: AiRunMeta;
  toolCalls: AiToolCall[];
  // The current turn's text as it streams - a live caption, not the reply.
  text: string | null;
}

// Compact view of the one in-flight run, for callers that only need
// "is something running and what is it doing" (see aiStream.ts).
export function useAiRunStream(): AiRunStreamState {
  const { run } = useAiStream();
  if (!run) return { active: false, kind: null, meta: {}, toolCalls: [], text: null };
  return {
    active: !run.finished,
    kind: run.kind,
    meta: run.meta,
    toolCalls: run.activity.flatMap((a) =>
      a.type === "tool" ? [{ toolName: a.toolName, input: a.input, output: a.output, error: a.error, done: a.done }] : []
    ),
    text: run.text || null,
  };
}

export const aiSettingsQueryKey = ["congress", "ai", "settings"] as const;

export function fetchAiSettings(): Promise<AiSettings> {
  return fetch("/congress/ai/settings").then((res) => parseJsonResponse<AiSettings>(res));
}
