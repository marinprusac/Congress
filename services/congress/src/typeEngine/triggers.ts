import { and, eq } from "drizzle-orm";
import type { FieldDefinition, RecordDto, TimeTrigger, TypeDefinition } from "@congress/shared-types";
import { exhibitsDb, exhibitsSqlite } from "./db/client.js";
import { recordTriggerState } from "./db/schema.js";
import { listTypes, onTypesChanged, type StoredType } from "./store.js";
import { quoteIdent } from "./ddl.js";
import { andClauses } from "./feedRules.js";
import { EVENT_SOURCE, eventPayload, onRecordWrite, titleOf } from "./records.js";
import { addDays, dayOf, endOfDay, ownerZone, refreshOwnerZone, startOfDay } from "./zone.js";
import { publishEvent } from "../events.js";
import type { Stored } from "./casts.js";

// Time-trigger ladders: each record's state on a ladder is the latest step it
// has reached (field + offset <= now, with the `and` conditions holding). A
// changed state publishes that step's event; falling out of every step
// publishes the clear event. One timer wakes at the soonest next step.

const MINUTE = 60_000;
const DAY = 86_400_000;
// Keeps setTimeout under its 2^31 ms limit; the timer just re-arms.
export const MAX_TIMEOUT_MS = 24 * DAY;

type Row = Record<string, Stored>;
type Step = TimeTrigger["steps"][number];

// Pure: the instant a stored value stands for.
export function instantOf(f: Pick<FieldDefinition, "kind">, value: Stored, anchor: TimeTrigger["anchor"], zone: string): number | null {
  if (value === null || value === "") return null;
  if (f.kind === "date") return anchor === "start_of_day" ? startOfDay(String(value), zone) : endOfDay(String(value), zone);
  const ms = Number(value);
  return Number.isFinite(ms) ? ms : null;
}

// Pure: the latest step reached at `now`, if any.
export function stepReached(instant: number, steps: Step[], now: number): Step | null {
  let best: Step | null = null;
  for (const s of steps) {
    if (instant + s.offsetMinutes * MINUTE <= now && (!best || s.offsetMinutes >= best.offsetMinutes)) best = s;
  }
  return best;
}

function ladderField(def: TypeDefinition, trigger: TimeTrigger): FieldDefinition | undefined {
  return def.fields.find((f) => f.id === trigger.field && !f.retired);
}

// Rows the ladder applies to (field set, conditions hold), plus extra SQL.
function ladderRows(def: TypeDefinition, trigger: TimeTrigger, extra: string, extraParams: Stored[], tail = ""): Row[] {
  const f = ladderField(def, trigger);
  if (!f) return [];
  let conds: ReturnType<typeof andClauses>;
  try {
    conds = andClauses(def, trigger.and);
  } catch {
    return [];
  }
  const col = quoteIdent(f.column);
  const where = [`${col} IS NOT NULL`, ...(f.kind === "date" ? [`${col} <> ''`] : []), ...conds.clauses, ...(extra ? [extra] : [])];
  return exhibitsSqlite
    .prepare(`SELECT * FROM ${quoteIdent(def.tableName)} WHERE ${where.join(" AND ")} ${tail}`)
    .all(...conds.params, ...extraParams) as Row[];
}

function currentStep(def: TypeDefinition, trigger: TimeTrigger, row: Row | undefined, now: number, zone: string): Step | null {
  const f = ladderField(def, trigger);
  if (!f || !row) return null;
  const instant = instantOf(f, row[f.column] ?? null, trigger.anchor, zone);
  return instant === null ? null : stepReached(instant, trigger.steps, now);
}

function storedStates(typeId: string, ladder: string, recordId?: string): Map<string, string> {
  const where = recordId
    ? and(eq(recordTriggerState.ladder, ladder), eq(recordTriggerState.recordId, recordId))
    : and(eq(recordTriggerState.typeId, typeId), eq(recordTriggerState.ladder, ladder));
  return new Map(exhibitsDb.select().from(recordTriggerState).where(where).all().map((r) => [r.recordId, r.state]));
}

function publish(t: StoredType, event: string, id: string, title: string): void {
  publishEvent({ chamber: EVENT_SOURCE, type: `${t.definition.eventPrefix}.${event}`, payload: eventPayload(t, id, title) });
}

// Moves one record from `prev` to `cur`, publishing and storing the change.
function transition(t: StoredType, trigger: TimeTrigger, id: string, title: string, cur: Step | null, prev: string | undefined, now: number): void {
  if (cur && cur.event !== prev) {
    exhibitsDb
      .insert(recordTriggerState)
      .values({ recordId: id, typeId: t.id, ladder: trigger.field, state: cur.event, firedAt: new Date(now) })
      .onConflictDoUpdate({ target: [recordTriggerState.recordId, recordTriggerState.ladder], set: { state: cur.event, firedAt: new Date(now) } })
      .run();
    publish(t, cur.event, id, title);
  } else if (!cur && prev !== undefined) {
    exhibitsDb.delete(recordTriggerState).where(and(eq(recordTriggerState.recordId, id), eq(recordTriggerState.ladder, trigger.field))).run();
    if (trigger.clearEvent) publish(t, trigger.clearEvent.event, id, title);
  }
}

// One record, right after a write (or its delete).
export function evaluateRecord(t: StoredType, id: string, deleted?: RecordDto, now = Date.now()): void {
  const def = t.definition;
  const zone = ownerZone();
  for (const trigger of def.timeTriggers) {
    const prev = storedStates(t.id, trigger.field, id).get(id);
    const row = deleted ? undefined : ladderRows(def, trigger, `"id" = ?`, [id])[0];
    const cur = currentStep(def, trigger, row, now, zone);
    if (!cur && prev === undefined) continue;
    const titleRow = row ?? (deleted ? undefined : (exhibitsSqlite.prepare(`SELECT * FROM ${quoteIdent(def.tableName)} WHERE "id" = ?`).get(id) as Row | undefined));
    const title = deleted ? titleFromDto(def, deleted) : titleRow ? titleOf(def, titleRow) : "";
    transition(t, trigger, id, title, cur, prev, now);
  }
}

function titleFromDto(def: TypeDefinition, dto: RecordDto): string {
  const f = def.fields.find((x) => x.id === def.titleField);
  return (f && String(dto.values[f.slug] ?? "")) || "";
}

// Upper bound (in the column's own terms) for rows that may have reached a step.
function reachedBound(f: FieldDefinition, trigger: TimeTrigger, now: number, zone: string): Stored {
  const earliest = Math.min(...trigger.steps.map((s) => s.offsetMinutes)) * MINUTE;
  const latestInstant = now - earliest;
  return f.kind === "date" ? dayOf(latestInstant + DAY, zone) : latestInstant;
}

// Every ladder of every type.
export function evaluateAll(now = Date.now()): void {
  const zone = ownerZone();
  for (const t of listTypes({ includeHidden: true })) {
    const def = t.definition;
    for (const trigger of def.timeTriggers) {
      const f = ladderField(def, trigger);
      if (!f) continue;
      const rows = ladderRows(def, trigger, `${quoteIdent(f.column)} <= ?`, [reachedBound(f, trigger, now, zone)]);
      const stored = storedStates(t.id, trigger.field);
      const seen = new Set<string>();
      for (const row of rows) {
        const id = String(row.id);
        seen.add(id);
        const cur = currentStep(def, trigger, row, now, zone);
        transition(t, trigger, id, titleOf(def, row), cur, stored.get(id), now);
      }
      // Stored states whose record no longer qualifies fall out of the ladder.
      for (const [id, prev] of stored) {
        if (seen.has(id)) continue;
        const row = exhibitsSqlite.prepare(`SELECT * FROM ${quoteIdent(def.tableName)} WHERE "id" = ?`).get(id) as Row | undefined;
        transition(t, trigger, id, row ? titleOf(def, row) : "", null, prev, now);
      }
    }
  }
}

// The soonest future step across every ladder, or null.
export function nextWakeAt(now = Date.now()): number | null {
  const zone = ownerZone();
  let next: number | null = null;
  for (const t of listTypes({ includeHidden: true })) {
    const def = t.definition;
    for (const trigger of def.timeTriggers) {
      const f = ladderField(def, trigger);
      if (!f) continue;
      // Per step, the smallest value whose step is still ahead. For a date,
      // instant + offset > now means day >= day(now - offset), +1 if anchored at the start.
      for (const step of trigger.steps) {
        const offset = step.offsetMinutes * MINUTE;
        const cutoff = dayOf(now - offset, zone);
        const lower = f.kind === "date" ? (trigger.anchor === "start_of_day" ? addDays(cutoff, 1) : cutoff) : now - offset + 1;
        const rows = ladderRows(def, trigger, `${quoteIdent(f.column)} >= ?`, [lower], `ORDER BY ${quoteIdent(f.column)} ASC LIMIT 3`);
        for (const row of rows) {
          const instant = instantOf(f, row[f.column] ?? null, trigger.anchor, zone);
          const at = instant === null ? null : instant + offset;
          if (at !== null && at > now && (next === null || at < next)) next = at;
        }
      }
    }
  }
  return next;
}

let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
const unsubscribers: (() => void)[] = [];

function tick(): void {
  try {
    evaluateAll();
  } catch (err) {
    console.error("[types] time triggers failed:", err);
  }
  rearm();
}

export function rearm(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (!running) return;
  const next = nextWakeAt();
  if (next === null) return;
  timer = setTimeout(() => {
    void refreshOwnerZone()
      .catch(() => undefined)
      .finally(tick);
  }, Math.min(Math.max(0, next - Date.now()), MAX_TIMEOUT_MS));
  timer.unref?.();
}

export async function startTimeTriggers(): Promise<void> {
  running = true;
  await refreshOwnerZone().catch((err) => console.warn("[types] owner time zone unavailable:", err));
  unsubscribers.push(
    onRecordWrite((t, id, deleted) => {
      if (t.definition.timeTriggers.length === 0) return;
      evaluateRecord(t, id, deleted);
      rearm();
    }),
    onTypesChanged(() => tick())
  );
  tick();
}

export function stopTimeTriggers(): void {
  running = false;
  if (timer) clearTimeout(timer);
  timer = undefined;
  for (const off of unsubscribers.splice(0)) off();
}
