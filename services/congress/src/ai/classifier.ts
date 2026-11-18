import { randomUUID } from "node:crypto";
import { reviewCandidates, markReviewed, visitContext, type VisitContext } from "../connectors/location/review.js";
import type { Visit } from "../connectors/location/types.js";
import { enqueue, JobCancelledError, PRIORITY } from "./jobQueue.js";
import { runAi, type RunOutcome } from "./engine.js";
import { getAiSettings } from "./settings.js";
import { publishProactiveRun } from "./proactive.js";

// The AI sorts out stops tracking couldn't place (the Map screens are gone, so
// nobody else will): every so often one cheap tool-using run looks at the
// recent unreviewed ones, decides what it can, and asks the owner about the rest.

export const BATCH_SIZE = 5;
export const MAX_ATTEMPTS = 3;
const TICK_MS = 60_000;

function dwellMinutes(v: Visit): string {
  const end = v.departedAt ? Date.parse(v.departedAt) : Date.now();
  return `${Math.max(1, Math.round((end - Date.parse(v.arrivedAt)) / 60_000))} min${v.departedAt ? "" : " so far, still there"}`;
}

function contextLine(c: VisitContext): string {
  const v = c.visit;
  const places = c.nearbyPlaces.length ? c.nearbyPlaces.map((p) => `${p.name} (${p.id}, ${p.distanceMeters} m away, radius ${p.radiusMeters} m)`).join("; ") : "none within 2 km";
  const labels = c.pastLabels.length ? c.pastLabels.map((l) => `"${l.label}" x${l.times}`).join(", ") : "none";
  return `- stop #${v.id}: arrived ${v.arrivedAt}, ${dwellMinutes(v)}; at ${v.latitude}, ${v.longitude}. Nearest Places: ${places}. Earlier labels here: ${labels}.`;
}

export function classifyPromptBody(contexts: VisitContext[]): string {
  return `## Sorting out stops
Nobody asked: the owner stopped at spots that match none of their Places, and no screen shows them any more, so it's yours to sort out, quietly. Decide what you can; ask only when you truly can't tell.

Per stop, gather cues first (a few cheap calls at most): the nearest Places, earlier labels at the same spot, calendar events around that time (list_events with from/to; an event's place), and only if it clearly helps, the owner's mail or WhatsApp around then. Then:
- **Confident it's a Place they have:** location_classify_visit action "place" with its id (also when it sits just outside the Place's radius).
- **Confident it's somewhere they'll come back to** (home, a shop, a gym, a friend's, a workplace): create_place with a good name, the stop's latitude/longitude and a radius (about 100 m); the history rebuild then confirms the stop on its own. Search first so you don't duplicate a Place.
- **A one-off spot with a clear label** (an event's venue, a place on an errand): location_classify_visit action "label".
- **Nothing worth recording** (stuck in traffic, a short stop with no cues): action "ignore".
- **Unsure:** ask_question, one question per stop (list_open_asks first; never ask about the same stop twice), at most 3 questions in this run. Name the stop as "stop #id" with when and for how long in the prompt, put a map block showing it (and the nearest Place) in the prompt, and offer a choice of the likely Places and labels, "Something else" with a text field for the name, and "Skip it". Keep it quick to answer. When the owner answers you get a follow-up: apply it with location_classify_visit or create_place.

Only ask questions; send no other message. Stops you leave unasked are not looked at again, so decide each one now. End with one line on what you did.

### Stops to sort out
${contexts.map(contextLine).join("\n")}`;
}

let running = false;
let lastRunAt = 0;
const failures = new Map<number, number>();

export function resetClassifier(): void {
  running = false;
  lastRunAt = 0;
  failures.clear();
}

// Runs one pass when the interval has passed and stops are waiting.
export async function maybeClassify(now = Date.now(), run: (body: string, model: string, signal: AbortSignal, runId: string) => Promise<RunOutcome> = defaultRun): Promise<RunOutcome | null> {
  if (running) return null;
  running = true;
  try {
    const settings = await getAiSettings();
    if (!settings.classifierEnabled || !settings.proactiveEnabled || settings.paused) return null;
    if (now - lastRunAt < settings.linkerIntervalMinutes * 60_000) return null;
    const batch = await reviewCandidates(now, BATCH_SIZE);
    if (!batch.length) return null;
    lastRunAt = now;
    const contexts = await Promise.all(batch.map(visitContext));
    const runId = randomUUID();
    const result = await enqueue((signal) => run(classifyPromptBody(contexts), settings.lightModel, signal, runId), {
      entry: { runId, kind: "classify", threadId: null, meta: { stops: batch.length } },
      priority: PRIORITY.link,
    });
    settle(batch, result);
    publishProactiveRun("classify", "queue", result);
    return result;
  } catch (err) {
    if (!(err instanceof JobCancelledError)) console.warn("Place classifier failed:", err);
    return null;
  } finally {
    running = false;
  }
}

// Done stops are marked reviewed; a failed run retries up to MAX_ATTEMPTS; a refused one (budget, paused) keeps them.
export function settle(batch: Visit[], outcome: { ok: boolean; refused: boolean }): void {
  if (outcome.refused) return;
  if (outcome.ok) {
    markReviewed(batch);
    for (const v of batch) failures.delete(v.id);
    return;
  }
  const done = batch.filter((v) => {
    const n = (failures.get(v.id) ?? 0) + 1;
    failures.set(v.id, n);
    return n >= MAX_ATTEMPTS;
  });
  markReviewed(done);
}

function defaultRun(body: string, model: string, signal: AbortSignal, runId: string): Promise<RunOutcome> {
  return runAi({ kind: "classify", body, actor: "congress", runId, trigger: "queue", model, signal });
}

let interval: ReturnType<typeof setInterval> | undefined;

export function startClassifier(): void {
  interval = setInterval(() => void maybeClassify(), TICK_MS);
}

export function stopClassifier(): void {
  if (interval) clearInterval(interval);
}
