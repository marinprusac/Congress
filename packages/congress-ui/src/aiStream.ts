import { useEffect, useRef, useSyncExternalStore } from "react";
import type { AiQueueSnapshot, AiRunKind, AiRunMeta, AiRunStatus, AiStreamEvent } from "@congress/shared-types";

// One EventSource per bundle on GET /congress/ai/runs/stream, shared by every
// hook below and reduced into the live state of the one in-flight run.

export interface AiLiveTool {
  type: "tool";
  toolUseId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  error?: string | null;
  done: boolean;
}
export type AiLiveActivity = { type: "note"; text: string } | AiLiveTool;

export interface AiLiveRun {
  runId: string;
  kind: AiRunKind;
  meta: AiRunMeta;
  threadId: number | null;
  startedAt: number;
  activity: AiLiveActivity[];
  // The current turn's text as it streams in.
  text: string;
  finished: boolean;
  status: AiRunStatus | null;
}

export interface AiStreamState {
  run: AiLiveRun | null;
  queue: AiQueueSnapshot;
  connected: boolean;
}

export type AiStreamMessage = AiStreamEvent | { type: "idle" } | { type: "connection"; connected: boolean };

export const INITIAL_AI_STREAM_STATE: AiStreamState = { run: null, queue: { running: null, waiting: [] }, connected: false };

function patchRun(state: AiStreamState, runId: string, patch: (run: AiLiveRun) => AiLiveRun): AiStreamState {
  if (!state.run || state.run.runId !== runId) return state;
  return { ...state, run: patch(state.run) };
}

// Pure, so it can be tested without a browser.
export function reduceAiStream(state: AiStreamState, event: AiStreamMessage): AiStreamState {
  switch (event.type) {
    case "connection":
      return { ...state, connected: event.connected };
    case "idle":
      return { ...state, run: null };
    case "queue":
      return { ...state, queue: { running: event.running, waiting: event.waiting } };
    case "thread_updated":
      return state;
    case "run_started":
      return {
        ...state,
        run: {
          runId: event.runId,
          kind: event.kind,
          meta: event.meta ?? {},
          threadId: event.threadId ?? null,
          startedAt: event.startedAt,
          activity: [],
          text: "",
          finished: false,
          status: null,
        },
      };
    case "assistant_delta":
      return patchRun(state, event.runId, (run) => ({ ...run, text: run.text + event.text }));
    case "assistant_text":
      return patchRun(state, event.runId, (run) => ({ ...run, text: event.text }));
    case "assistant_note":
      return patchRun(state, event.runId, (run) => ({ ...run, text: "", activity: [...run.activity, { type: "note", text: event.text }] }));
    case "tool_start":
      return patchRun(state, event.runId, (run) => {
        // A note already committed the text; otherwise any streamed text is moot.
        const activity = [...run.activity];
        if (run.text.trim() && activity.at(-1)?.type !== "note") activity.push({ type: "note", text: run.text });
        activity.push({ type: "tool", toolUseId: event.toolUseId, toolName: event.toolName, input: event.input, done: false });
        return { ...run, text: "", activity };
      });
    case "tool_result":
      return patchRun(state, event.runId, (run) => {
        const index = run.activity.findIndex((a) => a.type === "tool" && a.toolUseId === event.toolUseId);
        const activity = [...run.activity];
        const done: AiLiveTool = {
          type: "tool",
          toolUseId: event.toolUseId,
          toolName: event.toolName,
          input: index >= 0 ? (activity[index] as AiLiveTool).input : null,
          output: event.output,
          error: event.error,
          done: true,
        };
        if (index >= 0) activity[index] = done;
        else activity.push(done);
        return { ...run, activity };
      });
    case "run_finished":
      return patchRun(state, event.runId, (run) => ({ ...run, finished: true, status: event.status }));
    default:
      return state;
  }
}

const STREAM_URL = "/congress/ai/runs/stream";
const EVENT_TYPES = [
  "idle",
  "queue",
  "thread_updated",
  "run_started",
  "assistant_delta",
  "assistant_text",
  "assistant_note",
  "tool_start",
  "tool_result",
  "run_finished",
] as const;
// Closing right away would reconnect on every route change.
const CLOSE_DELAY_MS = 5_000;

let state: AiStreamState = INITIAL_AI_STREAM_STATE;
let source: EventSource | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
const stateListeners = new Set<() => void>();
const eventListeners = new Set<(event: AiStreamMessage) => void>();

function dispatch(event: AiStreamMessage): void {
  state = reduceAiStream(state, event);
  for (const listener of eventListeners) listener(event);
  for (const listener of stateListeners) listener();
}

function open(): void {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  if (source || typeof EventSource === "undefined") return;
  const es = new EventSource(STREAM_URL);
  source = es;
  es.onopen = () => dispatch({ type: "connection", connected: true });
  // EventSource retries by itself; the server replays on reconnect.
  es.onerror = () => dispatch({ type: "connection", connected: false });
  for (const type of EVENT_TYPES) {
    es.addEventListener(type, (e) => {
      if (type === "idle") return dispatch({ type: "idle" });
      try {
        dispatch(JSON.parse((e as MessageEvent).data) as AiStreamEvent);
      } catch {
        // Malformed frame; skip it.
      }
    });
  }
}

function retain(): () => void {
  open();
  return () => {
    if (stateListeners.size + eventListeners.size > 0) return;
    closeTimer = setTimeout(() => {
      source?.close();
      source = null;
      state = { ...state, connected: false };
    }, CLOSE_DELAY_MS);
  };
}

function subscribeState(listener: () => void): () => void {
  stateListeners.add(listener);
  const release = retain();
  return () => {
    stateListeners.delete(listener);
    release();
  };
}

// The live stream state (current run, queue, connection).
export function useAiStream(): AiStreamState {
  return useSyncExternalStore(subscribeState, () => state, () => INITIAL_AI_STREAM_STATE);
}

// Calls `handler` for every stream event (e.g. to invalidate queries).
export function useAiStreamEvents(handler: (event: AiStreamMessage) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const listener = (event: AiStreamMessage) => ref.current(event);
    eventListeners.add(listener);
    const release = retain();
    return () => {
      eventListeners.delete(listener);
      release();
    };
  }, []);
}
