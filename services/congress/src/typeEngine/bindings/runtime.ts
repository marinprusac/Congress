import { and, asc, eq, lte } from "drizzle-orm";
import type { Binding, FieldDefinition, RecordDto } from "@congress/shared-types";
import { exhibitsDb, exhibitsSqlite } from "../db/client.js";
import { bindingOutbox, bindingShadows } from "../db/schema.js";
import { listTypes, onTypesChanged, type StoredType } from "../store.js";
import { quoteIdent } from "../ddl.js";
import {
  beforeRecordWrite,
  createRecord,
  deleteRecord,
  findBySource,
  getRecord,
  onRecordWrite,
  RecordLockedError,
  RecordNotFoundError,
  setRecordSource,
  typeOfRecord,
  updateRecord,
  type Row,
  type WriteInfo,
} from "../records.js";
import { ConnectorRefusedError, type SourceRecord, type SourceValue } from "../../connectors/contract.js";
import { getConnector, onConnectorSynced, onSourceChange, type SourceChange } from "../../connectors/runtime.js";
import { runningConnector } from "../../connectors/registry.js";
import { availableActions, computeLocks, mappedValues, projectRich, sameValue, toSourceValue, toTargetValue } from "./mapping.js";

// Runs every type's bindings: pulls source changes into records, pushes the
// owner's edits back through an outbox, and guards what a source keeps read-only.

type OutboxRow = typeof bindingOutbox.$inferSelect;
interface Bound {
  t: StoredType;
  b: Binding;
}

const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 60 * 60_000;

function allBindings(): Bound[] {
  return listTypes({ includeHidden: true }).flatMap((t) => t.definition.bindings.map((b) => ({ t, b })));
}

function bindingsFor(connector: string, kind?: string): Bound[] {
  return allBindings().filter(({ b }) => b.connector === connector && (kind === undefined || b.kind === kind));
}

function bindingById(id: string): Bound | undefined {
  return allBindings().find(({ b }) => b.id === id);
}

function boundOf(t: StoredType, row: Row): Binding | undefined {
  return row.source_binding ? t.definition.bindings.find((b) => b.id === row.source_binding) : undefined;
}

const fieldOf = (t: StoredType, id: string) => t.definition.fields.find((f) => f.id === id && !f.retired);
const syncFields = (t: StoredType, b: Binding) =>
  b.fields.filter((m) => m.mode === "sync").flatMap((m) => {
    const f = fieldOf(t, m.target);
    return f ? [{ m, f }] : [];
  });

// --- shadows

function getShadow(recordId: string): Record<string, SourceValue> | null {
  const row = exhibitsDb.select().from(bindingShadows).where(eq(bindingShadows.recordId, recordId)).get();
  return row ? (JSON.parse(row.valuesJson) as Record<string, SourceValue>) : null;
}

function setShadow(recordId: string, bindingId: string, values: Record<string, SourceValue>): void {
  const valuesJson = JSON.stringify(values);
  exhibitsDb
    .insert(bindingShadows)
    .values({ recordId, bindingId, valuesJson, updatedAt: new Date() })
    .onConflictDoUpdate({ target: bindingShadows.recordId, set: { bindingId, valuesJson, updatedAt: new Date() } })
    .run();
}

function forget(recordId: string): void {
  exhibitsDb.delete(bindingShadows).where(eq(bindingShadows.recordId, recordId)).run();
  exhibitsDb.delete(bindingOutbox).where(eq(bindingOutbox.recordId, recordId)).run();
}

function outboxOf(recordId: string): OutboxRow | undefined {
  return exhibitsDb.select().from(bindingOutbox).where(eq(bindingOutbox.recordId, recordId)).get();
}

// --- pull

function pendingDelete(bindingId: string, key: string): boolean {
  return Boolean(
    exhibitsDb
      .select({ id: bindingOutbox.recordId })
      .from(bindingOutbox)
      .where(and(eq(bindingOutbox.bindingId, bindingId), eq(bindingOutbox.sourceKey, key)))
      .get()
  );
}

// Applies a source record: creates its record, or updates only the fields the
// source changed since it was last seen (so pending local edits survive).
export function pullRecord(t: StoredType, b: Binding, src: SourceRecord, opts: { quiet?: boolean; force?: boolean } = {}): string | null {
  if (pendingDelete(b.id, src.key)) return null;
  const mapped = mappedValues(b, src.values);
  const id = findBySource(t, b.id, src.key);
  if (!id) {
    const values: Record<string, unknown> = {};
    for (const m of b.fields) {
      const f = fieldOf(t, m.target);
      if (f) values[f.slug] = toTargetValue(mapped[m.source], f);
    }
    const dto = createRecord(t.definition.slug, values, {
      source: { binding: b.id, key: src.key },
      fromSource: true,
      quiet: opts.quiet,
      actor: b.connector,
    });
    setShadow(dto.id, b.id, mapped);
    return dto.id;
  }
  const shadow = opts.force ? null : getShadow(id);
  const current = getRecord(id);
  if (!current) return null;
  const patch: Record<string, unknown> = {};
  for (const m of b.fields) {
    const f = fieldOf(t, m.target);
    if (!f) continue;
    const incoming = mapped[m.source];
    if (shadow && m.source in shadow && sameValue(shadow[m.source], incoming)) continue;
    const have = current.values[f.slug];
    // A plain source keeps the chips of rich text that still reads the same.
    if (f.kind === "richtext" && typeof incoming === "string" && projectRich(String(have ?? "")) === incoming) continue;
    const next = toTargetValue(incoming, f);
    if (JSON.stringify(next) === JSON.stringify(have ?? null)) continue;
    patch[f.slug] = next;
  }
  if (Object.keys(patch).length > 0) {
    updateRecord(id, patch, { fromSource: true, quiet: opts.quiet, actor: b.connector });
    dropPending(id, Object.keys(patch));
  }
  setShadow(id, b.id, mapped);
  return id;
}

// The source won these fields: stop pushing the local values.
function dropPending(recordId: string, slugs: string[]): void {
  const row = exhibitsDb.select().from(bindingOutbox).where(eq(bindingOutbox.recordId, recordId)).get();
  if (!row || row.op !== "update" || row.failed) return;
  const left = (JSON.parse(row.fieldsJson) as string[]).filter((s) => !slugs.includes(s));
  if (left.length === 0) exhibitsDb.delete(bindingOutbox).where(eq(bindingOutbox.recordId, recordId)).run();
  else exhibitsDb.update(bindingOutbox).set({ fieldsJson: JSON.stringify(left) }).where(eq(bindingOutbox.recordId, recordId)).run();
}

function applyChange(change: SourceChange): void {
  for (const { t, b } of bindingsFor(change.connector, change.kind)) {
    if (change.deleted) {
      const id = findBySource(t, b.id, change.key);
      if (id) deleteRecord(id, { fromSource: true, actor: b.connector });
      continue;
    }
    const src = getConnector(change.connector)?.read.get(change.kind, change.key);
    if (src) pullRecord(t, b, src, { quiet: change.quiet });
  }
}

function boundCount(t: StoredType, b: Binding): number {
  const row = exhibitsSqlite
    .prepare(`SELECT count(*) AS n FROM ${quoteIdent(t.definition.tableName)} WHERE "source_binding" = ?`)
    .get(b.id) as { n: number };
  return Number(row.n);
}

// Pulls everything the connector has. Never deletes: records outlive the
// source's window; only a real delete (an emitted change) removes one.
export function reconcile(connector: string): number {
  if (holds.has(connector)) {
    holds.get(connector)!.reconcile = true;
    return 0;
  }
  const c = getConnector(connector);
  if (!c) return 0;
  let n = 0;
  for (const { t, b } of bindingsFor(connector)) {
    // The first pull is a backfill: no events for hundreds of old records.
    const quiet = boundCount(t, b) === 0;
    for (const src of c.read.list(b.kind)) {
      try {
        if (pullRecord(t, b, src, { quiet })) n++;
      } catch (err) {
        console.warn(`[bindings] ${b.id} ${src.key}: ${(err as Error).message}`);
      }
    }
  }
  return n;
}

// --- holding source changes while a create is in flight

const holds = new Map<string, { depth: number; changes: SourceChange[]; reconcile: boolean }>();

async function holding<T>(connector: string, fn: () => Promise<T>, then: (result: T) => void): Promise<T> {
  const h = holds.get(connector) ?? { depth: 0, changes: [], reconcile: false };
  h.depth++;
  holds.set(connector, h);
  try {
    const result = await fn();
    then(result);
    return result;
  } finally {
    h.depth--;
    if (h.depth === 0) {
      holds.delete(connector);
      for (const change of h.changes) safely(() => applyChange(change));
      if (h.reconcile) safely(() => reconcile(connector));
    }
  }
}

function safely(fn: () => unknown): void {
  try {
    fn();
  } catch (err) {
    console.warn(`[bindings] ${(err as Error).message}`);
  }
}

function onChange(change: SourceChange): void {
  const h = holds.get(change.connector);
  if (h) h.changes.push(change);
  else applyChange(change);
}

// --- guard

function factsOf(b: Binding, key: string): Record<string, SourceValue> | null {
  const c = getConnector(b.connector);
  return c?.read.get(b.kind, key)?.facts ?? null;
}

function guard(t: StoredType, row: Row, op: "update" | "delete", changed: string[]): void {
  const b = boundOf(t, row);
  if (!b) return;
  const facts = factsOf(b, String(row.source_key));
  const locks = computeLocks(t.definition, b, facts);
  if (op === "delete") {
    if (b.delete === "never") throw new RecordLockedError([], `This comes from ${b.label} and can't be deleted here`);
    if (locks.reason) throw new RecordLockedError([], `${locks.reason}, so it can't be deleted here`);
    return;
  }
  const bad = changed.filter((s) => locks.locked.includes(s));
  if (bad.length) throw new RecordLockedError(bad, locks.reason ?? `Set by ${b.label}`);
}

// --- outbox

function enqueue(recordId: string, bindingId: string, op: OutboxRow["op"], fields: string[], sourceKey: string | null = null): void {
  const existing = exhibitsDb.select().from(bindingOutbox).where(eq(bindingOutbox.recordId, recordId)).get();
  // Edits pile onto a pending update or create; anything else replaces it.
  if (existing && !existing.failed && op === "update" && (existing.op === "update" || existing.op === "create" || existing.op === "move")) {
    const merged = [...new Set([...(JSON.parse(existing.fieldsJson) as string[]), ...fields])];
    // A fresh edit is worth trying now, even mid-backoff.
    exhibitsDb.update(bindingOutbox).set({ fieldsJson: JSON.stringify(merged), nextAt: new Date() }).where(eq(bindingOutbox.recordId, recordId)).run();
  } else {
    const now = new Date();
    const row = { bindingId, op, sourceKey, fieldsJson: JSON.stringify(fields), attempts: 0, nextAt: now, lastError: null, failed: false, createdAt: now };
    exhibitsDb.insert(bindingOutbox).values({ recordId, ...row }).onConflictDoUpdate({ target: bindingOutbox.recordId, set: row }).run();
  }
  kick();
}

function createBindingFor(t: StoredType, values: Record<string, unknown>): Binding | undefined {
  return t.definition.bindings.find((b) => {
    const f = b.create ? fieldOf(t, b.create.targetField) : undefined;
    return f && typeof values[f.slug] === "string" && values[f.slug] !== "";
  });
}

function onWrite(t: StoredType, id: string, deleted: RecordDto | undefined, info: WriteInfo | undefined): void {
  if (!info || info.op === "cleanup") return;
  if (info.op === "delete") {
    const b = deleted?.provenance ? t.definition.bindings.find((x) => x.id === deleted.provenance!.binding) : undefined;
    forget(id);
    if (b && !info.fromSource && b.delete === "push") enqueue(id, b.id, "delete", [], deleted!.provenance!.key);
    return;
  }
  if (info.fromSource || t.definition.bindings.length === 0) return;
  const row = exhibitsSqlite.prepare(`SELECT * FROM ${quoteIdent(t.definition.tableName)} WHERE "id" = ?`).get(id) as Row | undefined;
  if (!row) return;
  const rec = getRecord(id)!;
  const b = boundOf(t, row);
  if (!b) {
    // A local record given a destination (e.g. a calendar) goes to the source.
    const target = createBindingFor(t, rec.values);
    const f = target?.create ? fieldOf(t, target.create.targetField) : undefined;
    if (target && f && (info.op === "create" || info.changed.includes(f.slug))) enqueue(id, target.id, "create", []);
    return;
  }
  const synced = syncFields(t, b);
  const changed = synced.filter(({ f }) => info.changed.includes(f.slug)).map(({ f }) => f.slug);
  if (changed.length === 0) return;
  const target = b.create ? fieldOf(t, b.create.targetField) : undefined;
  if (target && changed.includes(target.slug)) {
    const key = String(row.source_key);
    if (rec.values[target.slug] === "") {
      // Back to local: unlink now so the next pull can't recreate it, then delete at the source.
      setRecordSource(t, id, null);
      exhibitsDb.delete(bindingShadows).where(eq(bindingShadows.recordId, id)).run();
      if (b.delete === "push") enqueue(id, b.id, "delete", [], key);
      else exhibitsDb.delete(bindingOutbox).where(eq(bindingOutbox.recordId, id)).run();
    } else enqueue(id, b.id, "move", [], key);
    return;
  }
  enqueue(id, b.id, "update", changed);
}

function sourceValues(t: StoredType, b: Binding, rec: RecordDto, only?: string[]): Record<string, SourceValue> {
  const out: Record<string, SourceValue> = {};
  for (const { m, f } of syncFields(t, b)) {
    if (only && !only.includes(f.slug)) continue;
    out[m.source] = toSourceValue(rec.values[f.slug], f as FieldDefinition);
  }
  return out;
}

// Done with the row as read: edits piled on while the push ran become a new update.
function settle(row: OutboxRow, ops: OutboxRow["op"][] = [row.op]): void {
  const now = outboxOf(row.recordId);
  if (!now || now.createdAt.getTime() !== row.createdAt.getTime() || !ops.includes(now.op)) return;
  const pushed = JSON.parse(row.fieldsJson) as string[];
  const left = (JSON.parse(now.fieldsJson) as string[]).filter((s) => !pushed.includes(s));
  if (left.length === 0) {
    exhibitsDb.delete(bindingOutbox).where(eq(bindingOutbox.recordId, row.recordId)).run();
    return;
  }
  exhibitsDb
    .update(bindingOutbox)
    .set({ op: "update", fieldsJson: JSON.stringify(left), sourceKey: null, attempts: 0, nextAt: new Date(), lastError: null })
    .where(eq(bindingOutbox.recordId, row.recordId))
    .run();
}

async function pushOne(row: OutboxRow): Promise<void> {
  const bound = bindingById(row.bindingId);
  if (!bound) return void exhibitsDb.delete(bindingOutbox).where(eq(bindingOutbox.recordId, row.recordId)).run();
  const { t, b } = bound;
  const running = runningConnector(b.connector);
  if (!running?.connector.push) throw new Error(`${b.label} isn't running`);
  const { connector, ctx } = running;
  const push = connector.push!;

  if (row.op === "delete") {
    await push.delete(ctx, b.kind, row.sourceKey!);
    return settle(row);
  }
  const rec = getRecord(row.recordId);
  if (!rec) return settle(row);

  if (row.op === "update") {
    if (rec.provenance?.binding !== b.id) return settle(row);
    const patch = sourceValues(t, b, rec, JSON.parse(row.fieldsJson) as string[]);
    if (Object.keys(patch).length > 0) pullRecord(t, b, await push.update(ctx, b.kind, rec.provenance.key, patch));
    return settle(row);
  }

  // create or move: make it at the (new) destination, then relink the record.
  const values = sourceValues(t, b, rec);
  await holding(
    b.connector,
    () => push.create(ctx, b.kind, values),
    (src) => {
      setRecordSource(t, rec.id, { binding: b.id, key: src.key });
      exhibitsDb.delete(bindingShadows).where(eq(bindingShadows.recordId, rec.id)).run();
      pullRecord(t, b, src);
    }
  );
  if (row.op === "move" && row.sourceKey) {
    // Created: from here on only the old copy's delete is left (retried alone).
    exhibitsDb.update(bindingOutbox).set({ op: "delete" }).where(eq(bindingOutbox.recordId, row.recordId)).run();
    await push.delete(ctx, b.kind, row.sourceKey);
    return settle(row, ["delete"]);
  }
  settle(row);
}

function fail(row: OutboxRow, err: unknown): void {
  const message = (err as Error).message;
  if (err instanceof ConnectorRefusedError) {
    exhibitsDb.update(bindingOutbox).set({ failed: true, lastError: message }).where(eq(bindingOutbox.recordId, row.recordId)).run();
    revert(row);
    return;
  }
  const attempts = row.attempts + 1;
  const delay = Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_MAX_MS);
  exhibitsDb
    .update(bindingOutbox)
    .set({ attempts, lastError: message, nextAt: new Date(Date.now() + delay) })
    .where(eq(bindingOutbox.recordId, row.recordId))
    .run();
}

// A refused push: the record goes back to what the source has.
function revert(row: OutboxRow): void {
  const bound = bindingById(row.bindingId);
  const t = typeOfRecord(row.recordId);
  if (!bound || !t) return;
  const { b } = bound;
  const rec = getRecord(row.recordId);
  if (!rec) return;
  try {
    if (row.op === "update" && rec.provenance) {
      const src = getConnector(b.connector)?.read.get(b.kind, rec.provenance.key);
      if (src) pullRecord(t, b, src, { force: true });
    } else if (row.op === "create") {
      const f = b.create ? fieldOf(t, b.create.targetField) : undefined;
      if (f) updateRecord(rec.id, { [f.slug]: "" }, { fromSource: true, actor: b.connector });
    } else if (row.op === "move" && rec.provenance) {
      const src = getConnector(b.connector)?.read.get(b.kind, rec.provenance.key);
      if (src) pullRecord(t, b, src, { force: true });
    }
  } catch (err) {
    console.warn(`[bindings] revert ${row.recordId}: ${(err as Error).message}`);
  }
}

let draining: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let started = false;

function dueRows(): OutboxRow[] {
  return exhibitsDb
    .select()
    .from(bindingOutbox)
    .where(and(eq(bindingOutbox.failed, false), lte(bindingOutbox.nextAt, new Date())))
    .orderBy(asc(bindingOutbox.nextAt))
    .all();
}

// Pushes every due row, one at a time; resolves when none are due.
export function flushOutbox(): Promise<void> {
  if (draining) return draining;
  draining = (async () => {
    for (let rows = dueRows(); rows.length > 0; rows = dueRows()) {
      for (const row of rows) {
        try {
          await pushOne(row);
        } catch (err) {
          fail(row, err);
        }
      }
    }
  })().finally(() => {
    draining = null;
    arm();
  });
  return draining;
}

function kick(): void {
  if (!started) return;
  queueMicrotask(() => void flushOutbox());
}

function arm(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (!started) return;
  const next = exhibitsDb.select({ at: bindingOutbox.nextAt }).from(bindingOutbox).where(eq(bindingOutbox.failed, false)).orderBy(asc(bindingOutbox.nextAt)).get();
  if (!next) return;
  timer = setTimeout(() => void flushOutbox(), Math.max(0, next.at.getTime() - Date.now()));
  timer.unref?.();
}

// --- reads and actions

// What a single-record read shows: locks, actions, live values, pending push.
export function withBinding(dto: RecordDto): RecordDto {
  const t = typeOfRecord(dto.id);
  const b = dto.provenance && t ? t.definition.bindings.find((x) => x.id === dto.provenance!.binding) : undefined;
  const pending = outboxOf(dto.id);
  const pendingDto = pending ? { error: pending.lastError, failed: pending.failed, since: pending.createdAt.toISOString() } : null;
  if (!t || !b || !dto.provenance) {
    if (!pending || !t) return { ...dto, binding: null };
    const target = bindingById(pending.bindingId)?.b;
    return target
      ? { ...dto, binding: { id: target.id, connector: target.connector, label: target.label, locked: [], lockReason: null, actions: [], live: {}, pending: pendingDto } }
      : { ...dto, binding: null };
  }
  const src = getConnector(b.connector)?.read.get(b.kind, dto.provenance.key) ?? null;
  const locks = computeLocks(t.definition, b, src?.facts ?? null);
  const mapped = new Set(b.fields.map((m) => m.source));
  const live: Record<string, SourceValue> = {};
  for (const [k, v] of Object.entries(src?.values ?? {})) if (!mapped.has(k)) live[k] = v;
  return {
    ...dto,
    binding: {
      id: b.id,
      connector: b.connector,
      label: b.label,
      locked: locks.locked,
      lockReason: locks.reason,
      actions: availableActions(b, src?.facts ?? null).map((a) => ({ id: a.id, label: a.label })),
      live,
      detail: Boolean(getConnector(b.connector)?.read.detail),
      pending: pendingDto,
    },
  };
}

export async function runBindingAction(recordId: string, actionId: string): Promise<RecordDto> {
  const t = typeOfRecord(recordId);
  const rec = getRecord(recordId);
  if (!t || !rec) throw new RecordNotFoundError(`no record ${recordId}`);
  const b = rec.provenance ? t.definition.bindings.find((x) => x.id === rec.provenance!.binding) : undefined;
  if (!b || !rec.provenance) throw new RecordLockedError([], "This record isn't linked to a source");
  const action = availableActions(b, factsOf(b, rec.provenance.key)).find((a) => a.id === actionId);
  if (!action) throw new RecordLockedError([], `“${actionId}” isn't available on this record`);
  const running = runningConnector(b.connector);
  if (!running?.connector.push) throw new RecordLockedError([], `${b.label} isn't running`);
  const src = await running.connector.push.act(running.ctx, b.kind, rec.provenance.key, action.act, action.args);
  pullRecord(t, b, src);
  return withBinding(getRecord(recordId)!);
}

function boundRecord(recordId: string) {
  const t = typeOfRecord(recordId);
  const rec = getRecord(recordId);
  if (!t || !rec) throw new RecordNotFoundError(`no record ${recordId}`);
  const b = rec.provenance ? t.definition.bindings.find((x) => x.id === rec.provenance!.binding) : undefined;
  const running = b ? runningConnector(b.connector) : null;
  return { t, rec, b, key: rec.provenance?.key, running };
}

// The source's live content for a record (e.g. a thread's messages), or null when it has none.
export async function liveDetail(recordId: string, opts: Record<string, string> = {}): Promise<unknown> {
  const { b, key, running } = boundRecord(recordId);
  if (!b || !key || !running?.connector.read.detail) return null;
  return running.connector.read.detail(running.ctx, b.kind, key, opts);
}

// Pulls one source record in now (fetching it into the connector's cache first); the record id.
export async function materialize(t: StoredType, b: Binding, key: string, opts: { quiet?: boolean } = {}): Promise<string | null> {
  const existing = findBySource(t, b.id, key);
  if (existing) return existing;
  const running = runningConnector(b.connector);
  const c = running?.connector;
  if (!c) return null;
  const src = c.read.get(b.kind, key) ?? (c.read.fetch ? await c.read.fetch(running.ctx, b.kind, key, opts) : null);
  return src ? pullRecord(t, b, src, opts) : null;
}

// Searches the whole source behind a type; each hit says whether it's a record yet.
export async function searchSource(t: StoredType, query: string, limit: number) {
  const hits: { recordId: string | null; key: string; binding: string; values: Record<string, SourceValue> }[] = [];
  for (const b of t.definition.bindings) {
    const running = runningConnector(b.connector);
    if (!running?.connector.read.search) continue;
    for (const src of await running.connector.read.search(running.ctx, b.kind, query, limit)) {
      hits.push({ recordId: findBySource(t, b.id, src.key) ?? null, key: src.key, binding: b.id, values: src.values });
    }
  }
  return hits;
}

// Where new records of a type can go (the create target field's options).
export function bindingTargets(t: StoredType): { binding: string; field: string; label: string; targets: { value: string; label: string; group?: string }[] }[] {
  return t.definition.bindings.flatMap((b) => {
    const f = b.create ? fieldOf(t, b.create.targetField) : undefined;
    const c = getConnector(b.connector);
    if (!f || !c?.read.targets) return [];
    return [{ binding: b.id, field: f.slug, label: b.label, targets: c.read.targets(b.kind) }];
  });
}

// --- lifecycle

const offs: (() => void)[] = [];

export function startBindings(): void {
  if (started) return;
  started = true;
  offs.push(
    onSourceChange(onChange),
    onConnectorSynced((name) => safely(() => reconcile(name))),
    onRecordWrite(onWrite),
    beforeRecordWrite(guard),
    // A newly published binding pulls at once.
    onTypesChanged(() => {
      for (const name of new Set(allBindings().map(({ b }) => b.connector))) safely(() => reconcile(name));
    })
  );
  kick();
}

export function stopBindings(): void {
  started = false;
  for (const off of offs.splice(0)) off();
  if (timer) clearTimeout(timer);
  timer = undefined;
}
