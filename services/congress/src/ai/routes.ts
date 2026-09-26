import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { HttpBindings } from "@hono/node-server";
import {
  aiRunRequestSchema,
  postAiChatMessageRequestSchema,
  updateAiSettingsRequestSchema,
  type AiRunProgressEvent,
  type AiRunResult,
} from "@congress/shared-types";
import { requireInternalToken, requireSessionOrInternalToken } from "../auth.js";
import { requireSession } from "../sessionAuth.js";
import { getAiSettings, updateAiSettings } from "./settings.js";
import { todaySpendUsd } from "./spend.js";
import { listMessages, postChatMessage, clearThread } from "./chat.js";
import { enqueue } from "./jobQueue.js";
import { runAi } from "./engine.js";
import { getSnapshot, onProgress } from "./runStream.js";

// Mounted at /congress/ai (server.ts), ahead of the /api/:chamber/*
// wildcard. The browser reaches these with its session cookie; a Chamber's
// backend reaches /run (and reads settings, e.g. Deputy checking the pause
// switch before draining its event buffer) with the internal token.
export const aiRoutes = new Hono<{ Bindings: HttpBindings }>();

aiRoutes.get("/settings", requireSessionOrInternalToken, async (c) => c.json(await getAiSettings()));

aiRoutes.put("/settings", requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateAiSettingsRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  return c.json(await updateAiSettings(parsed.data));
});

aiRoutes.get("/settings/spend", requireSession, (c) => c.json({ spentTodayUsd: todaySpendUsd() }));

// Chat - blocks on the queued headless run itself rather than a
// fire-and-forget + poll shape; live progress comes from /runs/stream.
aiRoutes.get("/chat/messages", requireSession, (c) => c.json(listMessages()));

aiRoutes.post("/chat/messages", requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = postAiChatMessageRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  return c.json(await postChatMessage(parsed.data));
});

aiRoutes.delete("/chat/messages", requireSession, (c) => {
  clearThread();
  return c.body(null, 204);
});

// A Chamber's own AI run (e.g. a Deputy directive). Blocks until the queued
// run finishes. Always a 200 with the full result, even when the run failed
// or was refused (paused/over budget) - so the caller always gets
// errorMessage/refused rather than a bare status code.
aiRoutes.post("/run", requireInternalToken, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = aiRunRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  const { prompt, actor, meta } = parsed.data;
  try {
    const { sessionId: _sessionId, ...result } = await enqueue(() => runAi({ kind: "remote", body: prompt, actor, meta }));
    return c.json(result satisfies AiRunResult);
  } catch (err) {
    const failed: AiRunResult = {
      ok: false,
      refused: false,
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

// Live progress for whichever run (chat or remote) is in flight. A client
// connecting mid-run (or right after one finishes) is replayed the run's
// full event log first. Kept open indefinitely with a keepalive ping.
aiRoutes.get("/runs/stream", requireSessionOrInternalToken, (c) => {
  return streamSSE(c, async (stream) => {
    async function send(event: AiRunProgressEvent) {
      await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
    }

    const snapshot = getSnapshot();
    if (snapshot) {
      for (const event of snapshot.events) await send(event);
    } else {
      await stream.writeSSE({ event: "idle", data: "{}" });
    }

    const unsubscribe = onProgress((event) => void send(event));
    stream.onAbort(unsubscribe);

    while (!stream.aborted) {
      await stream.sleep(25_000);
      if (!stream.aborted) await stream.writeSSE({ event: "ping", data: "" });
    }
  });
});
