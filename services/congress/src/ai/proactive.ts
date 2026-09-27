import { randomUUID } from "node:crypto";
import { and, gt, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { aiEventBuffer } from "../db/schema.js";
import { onEventPublished, publishEvent, type PublishedEvent } from "../events.js";
import { getFeed } from "../feed.js";
import { enqueue, JobCancelledError, PRIORITY, queueSnapshot } from "./jobQueue.js";
import { runAi, type RunOutcome } from "./engine.js";
import { getAiSettings } from "./settings.js";
import { inQuietHours } from "./pushPolicy.js";
import { afterGate, eventWeight, initialMeter, observe, shouldFire, type MeterState } from "./meter.js";
import { listTracking, serverTimeZone, trackedItemLine } from "./memory.js";
import { listAsksForAi } from "./asks.js";
import { setRunVerdict } from "./runs.js";

// Congress's AI acting on its own: every event feeds the meter; when it
// crosses its threshold the cheap gate model decides whether a real,
// tool-using proactive run is worth it.

const BUFFER_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const DIGEST_MAX_EVENTS = 60;
const TICK_MS = 60_000;

export const gateVerdictSchema = z.object({
  act: z.boolean(),
  focus: z.string().max(300).default(""),
  urgency: z.enum(["quiet", "push"]).default("quiet"),
  reason: z.string().max(500).default(""),
});
export type GateVerdict = z.infer<typeof gateVerdictSchema>;

export const GATE_JSON_SCHEMA = {
  type: "object",
  properties: {
    act: { type: "boolean", description: "true only if something specific deserves the assistant's attention now" },
    focus: { type: "string", description: "What to look at, if act" },
    urgency: { type: "string", enum: ["quiet", "push"] },
    reason: { type: "string", description: "One sentence: why (or why not)" },
  },
  required: ["act", "reason"],
  additionalProperties: false,
} as const;

// Invalid or missing output means "don't act".
export function parseVerdict(response: string | null): GateVerdict {
  try {
    const parsed = gateVerdictSchema.safeParse(JSON.parse(response ?? ""));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through
  }
  return { act: false, focus: "", urgency: "quiet", reason: "No usable verdict." };
}

// ---- Event buffer ----

export function bufferEvent(event: PublishedEvent): void {
  if (eventWeight(event, new Set()) === 0) return;
  db.insert(aiEventBuffer)
    .values({
      chamber: event.chamber,
      type: event.type,
      payloadJson: event.payload === undefined ? null : JSON.stringify(event.payload).slice(0, 2000),
      actor: event.actor ?? null,
      occurredAt: new Date(event.occurredAt),
    })
    .run();
}

export function pruneEventBuffer(now = Date.now()): void {
  db.delete(aiEventBuffer).where(lt(aiEventBuffer.occurredAt, new Date(now - BUFFER_MAX_AGE_MS))).run();
}

function eventsSince(since: number) {
  return db
    .select()
    .from(aiEventBuffer)
    .where(and(gt(aiEventBuffer.occurredAt, new Date(since))))
    .orderBy(aiEventBuffer.occurredAt)
    .all()
    .slice(-DIGEST_MAX_EVENTS);
}

// ---- Digest ----

function localTime(date: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

export async function buildDigest(since: number, zone: string): Promise<{ text: string; eventCount: number }> {
  const events = eventsSince(since);
  const items = listTracking(["active"]);
  const asks = (await listAsksForAi()).asks.filter((a) => a.state === "open" || a.state === "scheduled");
  const feed = await getFeed({ timeoutMs: 1500 }).catch(() => []);
  const upcoming = feed
    .filter((f) => f.kind === "exhibit")
    .slice(0, 10)
    .map((f) => {
      const p = f.kind === "exhibit" ? f.preview : undefined;
      const when = p?.time?.start ? ` (${localTime(new Date(p.time.start), zone)})` : "";
      return `- ${f.chamber}: ${p?.title ?? (f.kind === "exhibit" ? f.name : "")}${when}${f.reason ? ` - ${f.reason}` : ""}`;
    });
  const sections = [
    `### Events since the last look (${events.length})`,
    events.length ? events.map((e) => `- ${localTime(e.occurredAt, zone)} ${e.chamber} · ${e.type}${e.payloadJson ? ` ${e.payloadJson.slice(0, 200)}` : ""}`).join("\n") : "- none",
    `### Tracked items`,
    items.length ? items.map((i) => trackedItemLine(i, zone)).join("\n") : "- none",
    `### Already waiting on the owner`,
    asks.length ? asks.map((a) => `- ${a.kind} (${a.state}): ${a.title || a.text.slice(0, 80)}`).join("\n") : "- nothing",
    `### Coming up / on the owner's plate`,
    upcoming.length ? upcoming.join("\n") : "- nothing notable",
  ];
  return { text: sections.join("\n"), eventCount: events.length };
}

export function gatePromptBody(digest: string): string {
  return `## Gate: should the assistant act on its own right now?
You decide whether Congress's assistant should take a proactive look now - to tell the owner something, ask them something, or prepare a change for approval. Most of the time the answer is no: say act=true only for something specific and timely that the owner would genuinely want (a deadline getting close, something that changed and matters, a follow-up that's due), never for routine noise, and never for something already waiting on the owner.

${digest}

Answer with the JSON verdict only.`;
}

export function proactivePromptBody(verdict: GateVerdict, digest: string): string {
  return `## Proactive check
Nobody asked you - Congress's gate flagged this: ${verdict.reason}${verdict.focus ? `\nFocus: ${verdict.focus}` : ""}
Suggested urgency: ${verdict.urgency}.

${digest}

Look at the relevant data with your tools and do what's genuinely useful. Reach the owner only through send_message / ask_question / propose_actions (check list_open_asks first; never repeat yourself). If it turns out nothing is needed, do nothing visible. Update tracked items if this changed them. End with a one-line summary (the owner doesn't see it).`;
}

// ---- Runtime ----

let meter: MeterState = initialMeter(Date.now());
let gating = false;
let interval: ReturnType<typeof setInterval> | undefined;
let unsubscribe: (() => void) | undefined;
let pruneCounter = 0;

export function meterState(): MeterState {
  return meter;
}

export function resetProactive(now = Date.now()): void {
  meter = initialMeter(now);
  gating = false;
}

function watchedTypes(): Set<string> {
  return new Set(listTracking(["active"]).flatMap((i) => i.watchEvents.map((w) => w.type)));
}

export function observeEvent(event: PublishedEvent, now = Date.now()): void {
  const weight = eventWeight(event, watchedTypes());
  if (weight === 0) return;
  bufferEvent(event);
  meter = observe(meter, weight, now);
  void maybeGate(now);
}

function autonomousRunActive(): boolean {
  const q = queueSnapshot();
  return [q.running, ...q.waiting].some((e) => e && (e.kind === "gate" || e.kind === "proactive"));
}

export function publishProactiveRun(kind: string, trigger: string, result: RunOutcome): void {
  if (!result.ok) return;
  publishEvent({
    chamber: "congress",
    type: "congress.ai_proactive_run",
    actor: "congress",
    payload: { kind, trigger, summary: result.response, toolCallCount: result.transcript.length, costUsd: result.costUsd },
  });
}

// Returns the verdict when the gate ran (for tests and the Activity view).
export async function maybeGate(now = Date.now()): Promise<GateVerdict | null> {
  // Taken synchronously: a burst of events must not start several gates.
  if (gating || autonomousRunActive()) return null;
  gating = true;
  try {
    const settings = await getAiSettings();
    if (!settings.proactiveEnabled || settings.paused) return null;
    const quiet = inQuietHours(new Date(now), settings.quietHoursStart, settings.quietHoursEnd, settings.timeZone);
    if (!shouldFire(meter, now, { heartbeatHours: settings.heartbeatHours, sensitivity: settings.gateSensitivity, quiet })) return null;
    const since = meter.lastGateAt;
    const zone = serverTimeZone(settings.timeZone);
    const digest = await buildDigest(since, zone);
    const gateRunId = randomUUID();
    const result = await enqueue(
      (signal) =>
        runAi({ kind: "gate", body: gatePromptBody(digest.text), actor: "congress", runId: gateRunId, trigger: "meter", model: settings.gateModel, jsonSchema: GATE_JSON_SCHEMA, signal }),
      { entry: { runId: gateRunId, kind: "gate", threadId: null, meta: {} }, priority: PRIORITY.gate }
    );
    const verdict = result.refused ? { act: false, focus: "", urgency: "quiet" as const, reason: result.errorMessage ?? "Refused." } : parseVerdict(result.response);
    setRunVerdict(gateRunId, { ...verdict, events: digest.eventCount });
    meter = afterGate(meter, Date.now(), verdict.act);
    if (verdict.act) startProactiveRun(verdict, digest.text, gateRunId);
    return verdict;
  } catch (err) {
    if (!(err instanceof JobCancelledError)) console.warn("Gate failed:", err);
    meter = afterGate(meter, Date.now(), false);
    return null;
  } finally {
    gating = false;
  }
}

function startProactiveRun(verdict: GateVerdict, digest: string, gateRunId: string): void {
  const runId = randomUUID();
  void enqueue(
    (signal) =>
      runAi({
        kind: "proactive",
        body: proactivePromptBody(verdict, digest),
        actor: "congress",
        runId,
        trigger: "gate",
        signal,
        meta: { gateRunId },
      }),
    { entry: { runId, kind: "proactive", threadId: null, meta: { gateRunId } }, priority: PRIORITY.proactive }
  )
    .then((result) => {
      setRunVerdict(runId, verdict);
      publishProactiveRun("proactive", "gate", result);
    })
    .catch((err: unknown) => {
      if (!(err instanceof JobCancelledError)) console.warn("Proactive run failed:", err);
    });
}

export function startProactive(): void {
  unsubscribe = onEventPublished((event) => observeEvent(event));
  interval = setInterval(() => {
    void maybeGate();
    if (++pruneCounter % 60 === 0) pruneEventBuffer();
  }, TICK_MS);
  pruneEventBuffer();
}

export function stopProactive(): void {
  unsubscribe?.();
  if (interval) clearInterval(interval);
}
