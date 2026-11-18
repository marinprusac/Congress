import { randomUUID } from "node:crypto";
import { asc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { aiLinkQueue } from "../db/schema.js";
import { onEventPublished, type PublishedEvent } from "../events.js";
import { getRecord, onRecordWrite, type WriteInfo } from "../typeEngine/records.js";
import { withBinding } from "../typeEngine/bindings/runtime.js";
import type { StoredType } from "../typeEngine/store.js";
import { NEW_CONTACT_EVENT } from "../connectors/whatsapp/cache.js";
import { enqueue, JobCancelledError, PRIORITY } from "./jobQueue.js";
import { runAi, type RunOutcome } from "./engine.js";
import { getAiSettings } from "./settings.js";
import { publishProactiveRun } from "./proactive.js";

// The AI linker: connections are drawn by the AI, not by connector code.
// Record writes and new WhatsApp contacts queue up; every so often one cheap
// (light model) tool-using run links a batch: People fields, connections,
// and People from the owner's direct contact.

export const BATCH_SIZE = 20;
// Let a burst (an autosaving note, a sync) settle before linking it.
export const SETTLE_MS = 2 * 60_000;
export const MAX_ATTEMPTS = 3;
const TICK_MS = 60_000;

// Writes by the AI itself never queue (no loops).
const AI_ACTORS = new Set(["congress", "ai-builder"]);

// Creates by anyone but the AI (not quiet backfills); updates only by the owner.
export function shouldQueueWrite(t: StoredType, info: WriteInfo): boolean {
  if (t.definition.hidden || info.quiet) return false;
  if (info.op === "create") return !AI_ACTORS.has(info.actor ?? "");
  if (info.op === "update") return info.actor === "me";
  return false;
}

export function queueLink(key: string, label: string, now = new Date()): void {
  db.insert(aiLinkQueue)
    .values({ key, label, queuedAt: now })
    .onConflictDoUpdate({ target: aiLinkQueue.key, set: { label, queuedAt: now } })
    .run();
}

export function pendingLinks() {
  return db.select().from(aiLinkQueue).orderBy(asc(aiLinkQueue.queuedAt)).all();
}

// The oldest settled items.
export function settledBatch(now = Date.now()) {
  return db
    .select()
    .from(aiLinkQueue)
    .where(lte(aiLinkQueue.queuedAt, new Date(now - SETTLE_MS)))
    .orderBy(asc(aiLinkQueue.queuedAt))
    .limit(BATCH_SIZE)
    .all();
}

type Item = typeof aiLinkQueue.$inferSelect;

// A record's values, short enough for a cheap model: long text clipped, the
// source's unmapped values (mail addresses, guests) included.
function recordLine(id: string): string | null {
  const dto = getRecord(id);
  if (!dto) return null;
  const full = withBinding(dto);
  const clip = (v: unknown) => (typeof v === "string" && v.length > 300 ? `${v.slice(0, 300)}…` : v);
  const values = Object.fromEntries(Object.entries(full.values).filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && !v.length)).map(([k, v]) => [k, clip(v)]));
  const live = full.binding?.live ?? {};
  const extra = Object.keys(live).length ? ` source: ${JSON.stringify(live).slice(0, 600)}` : "";
  return `- [[record:e:${id}]] (${dto.type}) ${JSON.stringify(values).slice(0, 1200)}${extra}`;
}

export function linkPromptBody(items: Item[]): string | null {
  const records = items.filter((i) => i.key.startsWith("e:")).flatMap((i) => recordLine(i.key.slice(2)) ?? []);
  const contacts = items.filter((i) => i.key.startsWith("wa:")).map((i) => `- WhatsApp chat ${i.key.slice(3)}: ${i.label}`);
  if (!records.length && !contacts.length) return null;
  const sections = [
    `## Linking pass
Nobody asked: you're drawing connections between the owner's records, quietly. Never contact the owner here (no send_message, ask_question or propose_actions) and change nothing but links and People.

- **People:** where a record's type has a People field, add the People it involves (search_people, then update_<type> with the existing ids plus the new ones; never remove a link). Create a Person (find_or_create_person, with their email or phone and name) only from the owner's direct contact: an address marked "you wrote to them", or a WhatsApp contact below whose chat shows a real personal conversation (whatsapp_read_chat, a few messages are enough). Never from calendar guests alone, mail the owner didn't answer, newsletters, no-reply or automated senders, businesses, or group chats.
- **Connections:** when a record clearly concerns another record (a mail about an event, a note about a task or person, an event at a Place), add it with create_record_connection. Only clear, specific links; when unsure, skip. Look at get_record_connections first so you don't repeat one.
- **Types:** only if these items show a recurring kind of thing no type covers, you may create one with the builder tools. Rarely.

Be economical: a few searches per item at most. End with one line on what you linked (the owner doesn't see it).`,
  ];
  if (records.length) sections.push(`### New or edited records\n${records.join("\n")}`);
  if (contacts.length) sections.push(`### New direct WhatsApp contacts (no Person has the number)\n${contacts.join("\n")}`);
  return sections.join("\n\n");
}

// After a run: done items leave; a failed run counts an attempt; a refused run (budget, paused) keeps them.
export function settle(items: Item[], outcome: { ok: boolean; refused: boolean }): void {
  const keys = items.map((i) => i.key);
  if (!keys.length || outcome.refused) return;
  if (outcome.ok) {
    db.delete(aiLinkQueue).where(inArray(aiLinkQueue.key, keys)).run();
    return;
  }
  db.update(aiLinkQueue).set({ attempts: sql`${aiLinkQueue.attempts} + 1` }).where(inArray(aiLinkQueue.key, keys)).run();
  for (const i of items) if (i.attempts + 1 >= MAX_ATTEMPTS) db.delete(aiLinkQueue).where(eq(aiLinkQueue.key, i.key)).run();
}

let linking = false;
let lastRunAt = 0;

export function resetLinker(): void {
  linking = false;
  lastRunAt = 0;
}

// Runs one pass when the interval has passed and something has settled.
export async function maybeLink(now = Date.now(), run: (body: string, model: string, signal: AbortSignal, runId: string) => Promise<RunOutcome> = defaultRun): Promise<RunOutcome | null> {
  if (linking) return null;
  linking = true;
  try {
    const settings = await getAiSettings();
    if (!settings.linkerEnabled || !settings.proactiveEnabled || settings.paused) return null;
    if (now - lastRunAt < settings.linkerIntervalMinutes * 60_000) return null;
    const items = settledBatch(now);
    if (!items.length) return null;
    const body = linkPromptBody(items);
    if (!body) {
      settle(items, { ok: true, refused: false });
      return null;
    }
    lastRunAt = now;
    const runId = randomUUID();
    const result = await enqueue((signal) => run(body, settings.lightModel, signal, runId), {
      entry: { runId, kind: "link", threadId: null, meta: { items: items.length } },
      priority: PRIORITY.link,
    });
    settle(items, result);
    publishProactiveRun("link", "queue", result);
    return result;
  } catch (err) {
    if (!(err instanceof JobCancelledError)) console.warn("Linker failed:", err);
    return null;
  } finally {
    linking = false;
  }
}

function defaultRun(body: string, model: string, signal: AbortSignal, runId: string): Promise<RunOutcome> {
  return runAi({ kind: "link", body, actor: "congress", runId, trigger: "queue", model, signal });
}

export function observeForLinker(event: PublishedEvent): void {
  if (event.type !== NEW_CONTACT_EVENT) return;
  const p = (event.payload ?? {}) as { jid?: string; phone?: string; name?: string | null; ownerMessages?: number };
  if (!p.jid) return;
  queueLink(`wa:${p.jid}`, `"${p.name ?? "unnamed"}" ${p.phone ?? ""}, the owner wrote ${p.ownerMessages ?? "?"} of the last 100 messages`);
}

let unsubscribers: (() => void)[] = [];
let interval: ReturnType<typeof setInterval> | undefined;

export function startLinker(): void {
  unsubscribers = [
    onRecordWrite((t, id, _deleted, info) => {
      if (info && shouldQueueWrite(t, info)) queueLink(`e:${id}`, t.definition.slug);
    }),
    onEventPublished(observeForLinker),
  ];
  interval = setInterval(() => void maybeLink(), TICK_MS);
}

export function stopLinker(): void {
  for (const u of unsubscribers) u();
  unsubscribers = [];
  if (interval) clearInterval(interval);
}
