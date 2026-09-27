import type { AiQueueEntry, AiQueueSnapshot } from "@congress/shared-types";

// A single in-process job queue, concurrency 1 - never two `claude`
// subprocesses at once. Lower priority number runs first (FIFO within one).
// Queued jobs can be removed; the running one is told to stop via its signal.
export const PRIORITY = { interactive: 0, tracking: 1, proactive: 2, gate: 3 } as const;

export class JobCancelledError extends Error {
  constructor() {
    super("Cancelled before it started.");
    this.name = "JobCancelledError";
  }
}

interface QueuedJob {
  entry: AiQueueEntry;
  priority: number;
  seq: number;
  controller: AbortController;
  run: (signal: AbortSignal) => Promise<void>;
  reject: (err: unknown) => void;
}

const waiting: QueuedJob[] = [];
let running: QueuedJob | null = null;
let seq = 0;
const listeners = new Set<(snapshot: AiQueueSnapshot) => void>();

export interface EnqueueOptions {
  entry: AiQueueEntry;
  priority?: number;
}

export function enqueue<T>(job: (signal: AbortSignal) => Promise<T>, opts: EnqueueOptions): Promise<T> {
  return new Promise((resolve, reject) => {
    const queued: QueuedJob = {
      entry: opts.entry,
      priority: opts.priority ?? PRIORITY.interactive,
      seq: seq++,
      controller: new AbortController(),
      reject,
      run: async (signal) => {
        try {
          resolve(await job(signal));
        } catch (err) {
          reject(err);
        }
      },
    };
    waiting.push(queued);
    waiting.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    notify();
    void drain();
  });
}

// Returns what happened: a queued job is dropped (its promise rejects with
// JobCancelledError), a running one is aborted and settles on its own.
export function cancelJob(runId: string): "queued" | "running" | null {
  const index = waiting.findIndex((j) => j.entry.runId === runId);
  if (index >= 0) {
    const [job] = waiting.splice(index, 1);
    job?.reject(new JobCancelledError());
    notify();
    return "queued";
  }
  if (running?.entry.runId === runId) {
    running.controller.abort();
    return "running";
  }
  return null;
}

export function queueSnapshot(): AiQueueSnapshot {
  return { running: running?.entry ?? null, waiting: waiting.map((j) => j.entry) };
}

export function onQueueChange(listener: (snapshot: AiQueueSnapshot) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  const snapshot = queueSnapshot();
  for (const listener of listeners) listener(snapshot);
}

async function drain(): Promise<void> {
  if (running) return;
  const next = waiting.shift();
  if (!next) return;
  running = next;
  notify();
  try {
    await next.run(next.controller.signal);
  } finally {
    running = null;
    notify();
    void drain();
  }
}
