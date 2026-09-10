import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

// Tracks Deputy's own live progress - tool calls in flight, turn-by-turn
// text, start/finish - and fans it out to any number of connected SSE
// clients (server.ts's GET /api/runs/stream). jobQueue.ts is concurrency-1,
// so there is at most one active run globally: no per-run-id fan-out is
// needed, just one "current run" slot. Replaces the old runningState.ts,
// which only ever tracked a bare directiveId|null for the directives list's
// polling spinner - this covers chat runs too (which never touched that),
// and carries enough detail for a live tool-call-by-tool-call view instead
// of a binary is-something-running flag.
export type RunKind = "chat" | "directive";

export type RunProgressEvent =
  | { type: "run_started"; runId: string; kind: RunKind; directiveId: number | null; startedAt: number }
  | { type: "tool_start"; runId: string; toolName: string; input: unknown }
  | { type: "tool_result"; runId: string; toolName: string; output: unknown; error: string | null }
  | { type: "assistant_text"; runId: string; text: string }
  | { type: "run_finished"; runId: string; ok: boolean; response: string | null; errorMessage: string | null };

interface CurrentRun {
  runId: string;
  kind: RunKind;
  directiveId: number | null;
  startedAt: number;
  // Every event emitted so far for this run, replayed in full to a client
  // that connects mid-run (or right after it finished) so it isn't left
  // showing nothing until the *next* run happens to produce an event.
  events: RunProgressEvent[];
}

const emitter = new EventEmitter();
// Emitters warn past 10 listeners by default - a personal system's own
// small number of simultaneously-open tabs/pages subscribing to this one
// stream is a completely ordinary case, not a leak to warn about.
emitter.setMaxListeners(50);

let currentRun: CurrentRun | null = null;

// Left populated (with its own terminal run_finished event already
// appended) after a run completes, rather than reset to null immediately -
// a client connecting right after a run finishes still sees its outcome via
// getSnapshot() instead of racing back to "nothing is running". The next
// startRun() overwrites it once a new run actually begins.
export function startRun(kind: RunKind, directiveId: number | null): string {
  const runId = randomUUID();
  const startedAt = Date.now();
  currentRun = { runId, kind, directiveId, startedAt, events: [] };
  emitProgress({ type: "run_started", runId, kind, directiveId, startedAt });
  return runId;
}

export function emitProgress(event: RunProgressEvent): void {
  if (currentRun && event.runId === currentRun.runId) currentRun.events.push(event);
  emitter.emit("progress", event);
}

export function finishRun(event: Extract<RunProgressEvent, { type: "run_finished" }>): void {
  emitProgress(event);
}

export function getSnapshot(): CurrentRun | null {
  return currentRun;
}

export function onProgress(listener: (event: RunProgressEvent) => void): () => void {
  emitter.on("progress", listener);
  return () => emitter.off("progress", listener);
}
