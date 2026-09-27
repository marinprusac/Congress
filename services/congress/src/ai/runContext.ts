import { AsyncLocalStorage } from "node:async_hooks";

// Which AI run (and thread) a call into Congress's own /mcp belongs to. The
// run's MCP config carries these headers for the Congress entry only.
export const RUN_ID_HEADER = "X-Congress-Run-Id";
export const THREAD_ID_HEADER = "X-Congress-Thread-Id";

export interface RunContextInfo {
  runId: string | null;
  threadId: number | null;
}

const storage = new AsyncLocalStorage<RunContextInfo>();

export function parseRunContext(get: (name: string) => string | undefined): RunContextInfo {
  const runId = get(RUN_ID_HEADER)?.trim() || null;
  const threadId = Number(get(THREAD_ID_HEADER));
  return { runId, threadId: Number.isInteger(threadId) && threadId > 0 ? threadId : null };
}

export function withRunContext<T>(ctx: RunContextInfo, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentRunContext(): RunContextInfo {
  return storage.getStore() ?? { runId: null, threadId: null };
}
