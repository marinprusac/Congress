import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { HttpBindings } from "@hono/node-server";
import { z } from "zod";
import {
  factTextSchema,
  updateTrackedItemRequestSchema,
  answerAskRequestSchema,
  decideAskRequestSchema,
  aiRunRequestSchema,
  createAiThreadRequestSchema,
  postAiThreadMessageRequestSchema,
  updateAiSettingsRequestSchema,
  updateAiThreadRequestSchema,
  type AiRunResult,
  type AiStreamEvent,
} from "@congress/shared-types";
import { requireInternalToken, requireSessionOrInternalToken } from "../auth.js";
import { requireSession } from "../sessionAuth.js";
import { getAiSettings, updateAiSettings } from "./settings.js";
import { todaySpendUsd } from "./spend.js";
import { createThread, postMessage, retryLast, ThreadBusyError, ThreadNotFoundError } from "./chat.js";
import { cancelJob, enqueue, onQueueChange, PRIORITY, queueSnapshot } from "./jobQueue.js";
import { runAi } from "./engine.js";
import { broadcast, onStreamEvent, replayEvents } from "./runStream.js";
import { deleteThreadRow, getThread, getThreadRow, listThreadMessages, listThreads, markThreadRead, updateThreadRow } from "./threads.js";
import { getRunDetail, listRecentRuns } from "./runs.js";
import { addFact, deleteFact, deleteTracking, getTracking, listFacts, listTracking, updateFact, updateTracking } from "./memory.js";
import { startTrackingCheck } from "./tracking.js";
import {
  AskClosedError,
  AskInvalidError,
  AskNotFoundError,
  answerQuestion,
  clearReadMessageNotifications,
  decideProposal,
  listOpenAsks,
} from "./asks.js";
import { randomUUID } from "node:crypto";

// Mounted at /congress/ai (server.ts), ahead of the /api/:chamber/*
// wildcard. The browser uses its session cookie; a Chamber's backend reaches
// /run and /settings with the internal token.
export const aiRoutes = new Hono<{ Bindings: HttpBindings }>();

// Every queue change is pushed to stream clients.
onQueueChange((snapshot) => broadcast({ type: "queue", ...snapshot }));

aiRoutes.get("/settings", requireSessionOrInternalToken, async (c) => c.json(await getAiSettings()));

aiRoutes.put("/settings", requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateAiSettingsRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  return c.json(await updateAiSettings(parsed.data));
});

aiRoutes.get("/settings/spend", requireSession, (c) => c.json({ spentTodayUsd: todaySpendUsd() }));

// ---- Threads ----

function threadId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

aiRoutes.get("/threads", requireSession, (c) => c.json(listThreads({ archived: c.req.query("archived") === "1" })));

aiRoutes.post("/threads", requireSession, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = createAiThreadRequestSchema.safeParse(body ?? {});
  if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  return c.json(createThread(parsed.data), 201);
});

aiRoutes.get("/threads/:id", requireSession, (c) => {
  const id = threadId(c.req.param("id"));
  const thread = id ? getThread(id) : null;
  return thread ? c.json(thread) : c.json({ error: "not_found" }, 404);
});

aiRoutes.patch("/threads/:id", requireSession, async (c) => {
  const id = threadId(c.req.param("id"));
  if (!id || !getThreadRow(id)) return c.json({ error: "not_found" }, 404);
  const parsed = updateAiThreadRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  const { title, pinned, archived } = parsed.data;
  updateThreadRow(id, {
    ...(title !== undefined ? { title } : {}),
    ...(pinned !== undefined ? { pinnedAt: pinned ? new Date() : null } : {}),
    ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
  });
  return c.json(getThread(id));
});

aiRoutes.delete("/threads/:id", requireSession, (c) => {
  const id = threadId(c.req.param("id"));
  const row = id ? getThreadRow(id) : null;
  if (!id || !row) return c.json({ error: "not_found" }, 404);
  if (row.pendingRunId) cancelJob(row.pendingRunId);
  deleteThreadRow(id);
  return c.body(null, 204);
});

aiRoutes.post("/threads/:id/read", requireSession, (c) => {
  const id = threadId(c.req.param("id"));
  if (!id || !getThreadRow(id)) return c.json({ error: "not_found" }, 404);
  markThreadRead(id);
  clearReadMessageNotifications(id);
  return c.body(null, 204);
});

aiRoutes.get("/threads/:id/messages", requireSession, (c) => {
  const id = threadId(c.req.param("id"));
  if (!id || !getThreadRow(id)) return c.json({ error: "not_found" }, 404);
  const before = Number(c.req.query("before"));
  return c.json(listThreadMessages(id, { before: Number.isInteger(before) && before > 0 ? before : undefined }));
});

function threadErrorResponse(err: unknown) {
  if (err instanceof ThreadNotFoundError) return { body: { error: "not_found" }, status: 404 as const };
  if (err instanceof ThreadBusyError) return { body: { error: "busy", message: err.message || "A reply is still in progress." }, status: 409 as const };
  throw err;
}

aiRoutes.post("/threads/:id/messages", requireSession, async (c) => {
  const id = threadId(c.req.param("id"));
  if (!id) return c.json({ error: "not_found" }, 404);
  const parsed = postAiThreadMessageRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  try {
    return c.json(postMessage(id, parsed.data.text), 201);
  } catch (err) {
    const { body, status } = threadErrorResponse(err);
    return c.json(body, status);
  }
});

aiRoutes.post("/threads/:id/retry", requireSession, (c) => {
  const id = threadId(c.req.param("id"));
  if (!id) return c.json({ error: "not_found" }, 404);
  try {
    return c.json(retryLast(id));
  } catch (err) {
    const { body, status } = threadErrorResponse(err);
    return c.json(body, status);
  }
});

// ---- Asks (the owner's side) ----

function askErrorResponse(err: unknown) {
  if (err instanceof AskNotFoundError) return { body: { error: "not_found" }, status: 404 as const };
  if (err instanceof AskClosedError) return { body: { error: "closed", message: err.message }, status: 409 as const };
  if (err instanceof AskInvalidError) return { body: { error: "invalid", message: err.message, fieldErrors: err.fieldErrors }, status: 400 as const };
  throw err;
}

aiRoutes.get("/asks", requireSession, (c) => c.json(listOpenAsks()));

aiRoutes.post("/messages/:id/answer", requireSession, async (c) => {
  const parsed = answerAskRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  try {
    return c.json(answerQuestion(Number(c.req.param("id")), parsed.data.values));
  } catch (err) {
    const { body, status } = askErrorResponse(err);
    return c.json(body, status);
  }
});

aiRoutes.post("/messages/:id/decide", requireSession, async (c) => {
  const parsed = decideAskRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  try {
    return c.json(decideProposal(Number(c.req.param("id")), parsed.data.approve, parsed.data.note || undefined));
  } catch (err) {
    const { body, status } = askErrorResponse(err);
    return c.json(body, status);
  }
});

// ---- Memory (tracked items + facts) ----

const positiveId = (raw: string) => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

aiRoutes.get("/tracking", requireSession, (c) => c.json(listTracking(c.req.query("closed") === "1" ? undefined : ["active", "paused"])));

aiRoutes.patch("/tracking/:id", requireSession, async (c) => {
  const id = positiveId(c.req.param("id"));
  const parsed = updateTrackedItemRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  const item = id ? updateTracking(id, parsed.data) : null;
  return item ? c.json(item) : c.json({ error: "not_found" }, 404);
});

aiRoutes.delete("/tracking/:id", requireSession, (c) => {
  const id = positiveId(c.req.param("id"));
  return id && deleteTracking(id) ? c.body(null, 204) : c.json({ error: "not_found" }, 404);
});

aiRoutes.post("/tracking/:id/check", requireSession, async (c) => {
  const id = positiveId(c.req.param("id"));
  if (!id || !getTracking(id)) return c.json({ error: "not_found" }, 404);
  const runId = await startTrackingCheck(id, "owner");
  return runId ? c.json({ runId }) : c.json({ error: "busy", message: "A check is already running." }, 409);
});

aiRoutes.get("/facts", requireSession, (c) => c.json(listFacts()));

aiRoutes.post("/facts", requireSession, async (c) => {
  const parsed = z.object({ text: factTextSchema }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  return c.json(addFact(parsed.data.text, "owner"), 201);
});

aiRoutes.patch("/facts/:id", requireSession, async (c) => {
  const id = positiveId(c.req.param("id"));
  const parsed = z.object({ text: factTextSchema }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  const fact = id ? updateFact(id, parsed.data.text) : null;
  return fact ? c.json(fact) : c.json({ error: "not_found" }, 404);
});

aiRoutes.delete("/facts/:id", requireSession, (c) => {
  const id = positiveId(c.req.param("id"));
  return id && deleteFact(id) ? c.body(null, 204) : c.json({ error: "not_found" }, 404);
});

// ---- Runs ----

// Live stream: the current run's progress (replayed to a new client), queue
// changes and thread updates. Kept open with a keepalive ping.
aiRoutes.get("/runs/stream", requireSessionOrInternalToken, (c) => {
  return streamSSE(c, async (stream) => {
    const send = async (event: AiStreamEvent) => {
      await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
    };

    await send({ type: "queue", ...queueSnapshot() });
    const replay = replayEvents();
    if (replay.length === 0) await stream.writeSSE({ event: "idle", data: "{}" });
    for (const event of replay) await send(event);

    const unsubscribe = onStreamEvent((event) => void send(event).catch(() => {}));
    stream.onAbort(unsubscribe);

    while (!stream.aborted) {
      await stream.sleep(25_000);
      if (!stream.aborted) await stream.writeSSE({ event: "ping", data: "" });
    }
  });
});

aiRoutes.get("/runs", requireSession, (c) => c.json(listRecentRuns()));

aiRoutes.get("/runs/:runId", requireSession, (c) => {
  const run = getRunDetail(c.req.param("runId"));
  return run ? c.json(run) : c.json({ error: "not_found" }, 404);
});

aiRoutes.post("/runs/:runId/cancel", requireSession, (c) => {
  const result = cancelJob(c.req.param("runId"));
  return result ? c.json({ cancelled: result }) : c.json({ error: "not_found" }, 404);
});

aiRoutes.get("/queue", requireSession, (c) => c.json(queueSnapshot()));

// A Chamber's own AI run. Blocks until the queued run finishes; always a 200
// with the full result, even when the run failed or was refused.
aiRoutes.post("/run", requireInternalToken, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = aiRunRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  const { prompt, actor, meta } = parsed.data;
  const runId = randomUUID();
  try {
    const outcome = await enqueue((signal) => runAi({ kind: "remote", body: prompt, actor, meta, runId, signal, trigger: actor }), {
      entry: { runId, kind: "remote", threadId: null, meta },
      priority: PRIORITY.tracking,
    });
    const { sessionId: _s, runId: _r, activity: _a, ...result } = outcome;
    return c.json(result satisfies AiRunResult);
  } catch (err) {
    const failed: AiRunResult = {
      ok: false,
      refused: false,
      cancelled: false,
      response: null,
      errorMessage: (err as Error).message,
      transcript: [],
      costUsd: null,
      inputTokens: null,
      outputTokens: null,
      durationMs: 0,
    };
    return c.json(failed);
  }
});
