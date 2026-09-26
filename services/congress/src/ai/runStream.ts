import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { AiRunKind, AiRunMeta, AiRunProgressEvent } from "@congress/shared-types";

// Tracks the live progress of whichever AI run is in flight - tool calls,
// turn-by-turn text, start/finish - and fans it out to every connected SSE
// client (GET /congress/ai/runs/stream). jobQueue.ts is concurrency-1, so
// there is at most one active run globally: one "current run" slot, no
// per-run fan-out.
interface CurrentRun {
  runId: string;
  kind: AiRunKind;
  meta: AiRunMeta;
  startedAt: number;
  // Every event emitted so far for this run, replayed in full to a client
  // that connects mid-run (or right after it finished).
  events: AiRunProgressEvent[];
}

const emitter = new EventEmitter();
// A handful of open tabs subscribing to this one stream is ordinary, not a
// leak to warn about.
emitter.setMaxListeners(50);

let currentRun: CurrentRun | null = null;

// Left populated (with its terminal run_finished event appended) after a run
// completes, so a client connecting right after still sees its outcome. The
// next startRun() overwrites it.
export function startRun(kind: AiRunKind, meta: AiRunMeta): string {
  const runId = randomUUID();
  const startedAt = Date.now();
  currentRun = { runId, kind, meta, startedAt, events: [] };
  emitProgress({ type: "run_started", runId, kind, meta, startedAt });
  return runId;
}

export function emitProgress(event: AiRunProgressEvent): void {
  if (currentRun && event.runId === currentRun.runId) currentRun.events.push(event);
  emitter.emit("progress", event);
}

export function finishRun(event: Extract<AiRunProgressEvent, { type: "run_finished" }>): void {
  emitProgress(event);
}

export function getSnapshot(): CurrentRun | null {
  return currentRun;
}

export function onProgress(listener: (event: AiRunProgressEvent) => void): () => void {
  emitter.on("progress", listener);
  return () => emitter.off("progress", listener);
}
