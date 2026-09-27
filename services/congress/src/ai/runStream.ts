import { EventEmitter } from "node:events";
import type { AiRunKind, AiRunMeta, AiRunProgressEvent, AiStreamEvent } from "@congress/shared-types";

// Live progress of whichever run is in flight, fanned out to every SSE client
// (GET /congress/ai/runs/stream). The queue is concurrency-1: one slot.
interface CurrentRun {
  runId: string;
  kind: AiRunKind;
  threadId: number | null;
  // Replayable events (no deltas); `liveText` holds the current turn's text.
  events: AiRunProgressEvent[];
  liveText: string;
  finished: boolean;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

let currentRun: CurrentRun | null = null;

export function startRun(runId: string, kind: AiRunKind, meta: AiRunMeta, threadId: number | null): void {
  currentRun = { runId, kind, threadId, events: [], liveText: "", finished: false };
  emitProgress({ type: "run_started", runId, kind, meta, threadId, startedAt: Date.now() });
}

export function emitProgress(event: AiRunProgressEvent): void {
  const run = currentRun && event.runId === currentRun.runId ? currentRun : null;
  if (run) {
    switch (event.type) {
      case "assistant_delta":
        run.liveText += event.text;
        break;
      case "assistant_text":
        run.liveText = event.text;
        break;
      case "tool_start":
        // Text written before a tool call is an interim note, not the reply.
        if (run.liveText.trim()) {
          const note: AiRunProgressEvent = { type: "assistant_note", runId: run.runId, text: run.liveText };
          run.events.push(note);
          emitter.emit("event", note);
        }
        run.liveText = "";
        run.events.push(event);
        break;
      case "run_finished":
        run.finished = true;
        run.events.push(event);
        break;
      default:
        run.events.push(event);
    }
  }
  emitter.emit("event", event);
}

export function finishRun(event: Extract<AiRunProgressEvent, { type: "run_finished" }>): void {
  emitProgress(event);
}

// What a client connecting now needs to rebuild the current run's view.
export function replayEvents(): AiRunProgressEvent[] {
  if (!currentRun) return [];
  const events = [...currentRun.events];
  if (!currentRun.finished && currentRun.liveText) {
    events.push({ type: "assistant_text", runId: currentRun.runId, text: currentRun.liveText });
  }
  return events;
}

export function broadcast(event: AiStreamEvent): void {
  emitter.emit("event", event);
}

export function notifyThreadUpdated(threadId: number): void {
  broadcast({ type: "thread_updated", threadId });
}

export function onStreamEvent(listener: (event: AiStreamEvent) => void): () => void {
  emitter.on("event", listener);
  return () => emitter.off("event", listener);
}
