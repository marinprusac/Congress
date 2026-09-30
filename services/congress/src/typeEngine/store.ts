import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { Operation, TypeDefinition, TypeSummary, TypeVersion } from "@congress/shared-types";
import { count } from "drizzle-orm";
import { typeDefinitionSchema } from "@congress/shared-types";
import { env } from "../env.js";
import { exhibitsDb, exhibitsSqlite } from "./db/client.js";
import { records, types, typeVersions } from "./db/schema.js";
import { applyOperations, OperationError, rollbackDefinition } from "./operations.js";
import { planMigration, type MigrationPlan } from "./planner.js";
import { isJoinField } from "./ddl.js";
import { backupDir, snapshot } from "./backups.js";
import { ulid } from "./ulid.js";
import { diffDefinitions } from "./diff.js";
import { keyClashes, keySignature, rebuildKeys } from "./keys.js";
import { bindingProblems } from "./bindings/mapping.js";
import { getConnector } from "../connectors/runtime.js";

// Owns every type definition: publishing applies ops, plans the migration
// and runs it together with the version row in one transaction.

export interface StoredType extends TypeSummary {
  premadeKey: string | null;
  premadeBatch: number;
  forked: boolean;
}

export class PublishError extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join("; "));
  }
}

export interface PublishInput {
  typeId?: string;
  ops: Operation[];
  actor: string;
  origin?: "premade" | "custom";
  premadeKey?: string;
  premadeBatch?: number;
}

export interface PublishResult {
  type: StoredType;
  plan: MigrationPlan;
  warnings: string[];
}

const cache = new Map<string, StoredType>();
const listeners = new Set<() => void>();
let loaded = false;

export function onTypesChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function ensureLoaded(): void {
  if (loaded) return;
  cache.clear();
  for (const row of exhibitsDb.select().from(types).all()) cache.set(row.id, toStored(row));
  loaded = true;
}

export function reloadTypes(): void {
  loaded = false;
  ensureLoaded();
}

function toStored(row: typeof types.$inferSelect): StoredType {
  return {
    id: row.id,
    version: row.currentVersion,
    origin: row.origin,
    definition: typeDefinitionSchema.parse(JSON.parse(row.definitionJson)),
    premadeKey: row.premadeKey,
    premadeBatch: row.premadeBatch,
    forked: row.forked,
  };
}

export function listTypes(opts: { includeHidden?: boolean } = {}): StoredType[] {
  ensureLoaded();
  return [...cache.values()].filter((t) => opts.includeHidden || !t.definition.hidden);
}

export function getType(id: string): StoredType | undefined {
  ensureLoaded();
  return cache.get(id);
}

export function getTypeBySlug(slug: string): StoredType | undefined {
  ensureLoaded();
  return [...cache.values()].find((t) => t.definition.slug === slug);
}

export function getTypeByPremadeKey(key: string): StoredType | undefined {
  ensureLoaded();
  return [...cache.values()].find((t) => t.premadeKey === key);
}

function tablesUsedExcept(typeId: string | undefined): Set<string> {
  const taken = new Set<string>();
  for (const t of cache.values()) {
    if (t.id === typeId) continue;
    taken.add(t.definition.tableName);
    for (const f of t.definition.fields) if (isJoinField(f)) taken.add(f.column);
  }
  return taken;
}

// Applies ops to the current definition; throws PublishError on any problem.
function prepare(typeId: string | undefined, ops: Operation[], opts: { premade?: boolean } = {}): { current: StoredType | undefined; def: TypeDefinition } {
  ensureLoaded();
  const current = typeId ? cache.get(typeId) : undefined;
  if (typeId && !current) throw new PublishError([`no type ${typeId}`]);
  let applied: ReturnType<typeof applyOperations>;
  try {
    applied = applyOperations(current?.definition ?? null, ops, { takenTables: tablesUsedExcept(typeId) });
  } catch (err) {
    if (err instanceof OperationError) throw new PublishError([err.message]);
    throw err;
  }
  if (applied.errors.length) throw new PublishError(applied.errors);
  const clash = [...cache.values()].find((t) => t.id !== current?.id && t.definition.slug === applied.def.slug);
  if (clash) throw new PublishError([`a type "${applied.def.slug}" already exists`]);
  const problems = [...relationProblems(current, applied.def), ...sourceProblems(current, applied.def, opts.premade === true)];
  if (problems.length) throw new PublishError(problems);
  return { current, def: applied.def };
}

// New or changed bindings must fit their connector's source schema. Premades
// install before connectors start, so an unknown connector is fine for them.
function sourceProblems(current: StoredType | undefined, def: TypeDefinition, premade: boolean): string[] {
  const before = new Map((current?.definition.bindings ?? []).map((b) => [b.id, JSON.stringify(b)]));
  const problems: string[] = [];
  for (const b of def.bindings) {
    if (before.get(b.id) === JSON.stringify(b)) continue;
    const connector = getConnector(b.connector);
    if (!connector) {
      if (!premade) problems.push(`no connector "${b.connector}" is running`);
      continue;
    }
    problems.push(...bindingProblems(def, b, connector.source.find((k) => k.kind === b.kind), Boolean(connector.push)));
  }
  return problems;
}

// Relations name their target by slug: it must exist, and a linked-to type keeps its slug.
function relationProblems(current: StoredType | undefined, def: TypeDefinition): string[] {
  const problems: string[] = [];
  const others = [...cache.values()].filter((t) => t.id !== current?.id);
  const slugs = new Set([def.slug, ...others.map((t) => t.definition.slug)]);
  for (const f of def.fields) {
    if (f.retired || f.kind !== "relation" || !f.options.target) continue;
    if (!slugs.has(f.options.target)) problems.push(`relation "${f.slug}": no type "${f.options.target}"`);
  }
  const oldSlug = current?.definition.slug;
  if (oldSlug && oldSlug !== def.slug) {
    const linking = others.flatMap((t) =>
      t.definition.fields.filter((f) => f.kind === "relation" && f.options.target === oldSlug).map((f) => `${t.definition.slug}.${f.slug}`)
    );
    if (linking.length) problems.push(`"${oldSlug}" can't be renamed while other types link to it (${linking.join(", ")})`);
  }
  return problems;
}

function prepareRollback(typeId: string, toVersion: number): { current: StoredType; def: TypeDefinition } {
  ensureLoaded();
  const current = cache.get(typeId);
  if (!current) throw new PublishError([`no type ${typeId}`]);
  const row = exhibitsDb.select().from(typeVersions).where(eq(typeVersions.typeId, typeId)).all().find((v) => v.version === toVersion);
  if (!row || toVersion >= current.version) throw new PublishError([`no earlier version ${toVersion}`]);
  const target = typeDefinitionSchema.parse(JSON.parse(row.definitionJson));
  const def = rollbackDefinition(current.definition, target);
  const problems = relationProblems(current, def);
  if (problems.length) throw new PublishError(problems);
  return { current, def };
}

export function publish(input: PublishInput): PublishResult {
  const { current, def } = prepare(input.typeId, input.ops, { premade: input.origin === "premade" || input.actor === "premade" });
  return commit(current, def, input.ops, input);
}

// Restores an earlier version's definition; fields added since stay, retired.
export function rollback(typeId: string, toVersion: number, actor: string): PublishResult {
  const { current, def } = prepareRollback(typeId, toVersion);
  return commit(current, def, [], { actor, ops: [] }, { rollbackTo: toVersion });
}

export interface PreflightCount {
  label: string;
  count: number;
}

export interface PublishPreview {
  definition: TypeDefinition | null;
  changes: ReturnType<typeof diffDefinitions>;
  plan: MigrationPlan | null;
  warnings: PreflightCount[];
  blockers: PreflightCount[];
  errors: string[];
}

function runPreflight(plan: MigrationPlan): { warnings: PreflightCount[]; blockers: PreflightCount[] } {
  const warnings: PreflightCount[] = [];
  const blockers: PreflightCount[] = [];
  for (const check of plan.preflight) {
    const n = Number((exhibitsSqlite.prepare(check.sql).get() as { n: number }).n);
    if (n > 0) (check.block ? blockers : warnings).push({ label: check.label, count: n });
  }
  return { warnings, blockers };
}

// Read-only: what publishing these ops (or this rollback) would do right now.
export function previewPublish(typeId: string | undefined, ops: Operation[]): PublishPreview {
  return preview(() => prepare(typeId, ops));
}

export function previewRollback(typeId: string, toVersion: number): PublishPreview {
  return preview(() => prepareRollback(typeId, toVersion));
}

function preview(prep: () => { current: StoredType | undefined; def: TypeDefinition }): PublishPreview {
  let prepared: ReturnType<typeof prep>;
  try {
    prepared = prep();
  } catch (err) {
    if (err instanceof PublishError) return { definition: null, changes: [], plan: null, warnings: [], blockers: [], errors: err.problems };
    throw err;
  }
  const before = prepared.current?.definition ?? null;
  const plan = planMigration(before, prepared.def);
  const counts = runPreflight(plan);
  if (prepared.current && keySignature(before ?? undefined) !== keySignature(prepared.def)) counts.blockers.push(...keyClashes(prepared.def));
  return { definition: prepared.def, changes: diffDefinitions(before, prepared.def), plan, ...counts, errors: [] };
}

export function listVersions(typeId: string): TypeVersion[] {
  const rows = exhibitsDb
    .select({ version: typeVersions.version, actor: typeVersions.actor, createdAt: typeVersions.createdAt, definitionJson: typeVersions.definitionJson })
    .from(typeVersions)
    .where(eq(typeVersions.typeId, typeId))
    .all()
    .sort((a, b) => a.version - b.version);
  let prev: TypeDefinition | null = null;
  const out: TypeVersion[] = [];
  for (const row of rows) {
    const def = typeDefinitionSchema.parse(JSON.parse(row.definitionJson));
    out.push({ version: row.version, actor: row.actor, createdAt: row.createdAt.toISOString(), changes: diffDefinitions(prev, def) });
    prev = def;
  }
  return out.reverse();
}

export function recordCount(typeId: string): number {
  return exhibitsDb.select({ n: count() }).from(records).where(eq(records.typeId, typeId)).get()?.n ?? 0;
}

function commit(
  current: StoredType | undefined,
  def: TypeDefinition,
  ops: Operation[],
  input: PublishInput,
  meta: { rollbackTo?: number } = {}
): PublishResult {
  const plan = planMigration(current?.definition ?? null, def);
  if (plan.rebuild) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    snapshot(exhibitsSqlite, join(backupDir(env.EXHIBITS_DB_PATH), `exhibits-prepublish-${def.slug}-${stamp}.sqlite3`));
  }

  const now = new Date();
  const id = current?.id ?? `typ_${ulid()}`;
  const version = (current?.version ?? 0) + 1;
  const warnings: string[] = [];

  exhibitsSqlite.transaction(() => {
    const counts = runPreflight(plan);
    if (counts.blockers.length) throw new PublishError(counts.blockers.map((b) => `${b.label} (${b.count})`));
    warnings.push(...counts.warnings.map((w) => `${w.label} (${w.count})`));
    for (const step of plan.steps) exhibitsSqlite.exec(step);
    if (current && keySignature(current.definition) !== keySignature(def)) {
      const clashes = keyClashes(def);
      if (clashes.length) throw new PublishError(clashes.map((c) => `${c.label} (${c.count})`));
      rebuildKeys(id, def);
    }

    const definitionJson = JSON.stringify(def);
    if (current) {
      exhibitsDb
        .update(types)
        .set({
          slug: def.slug,
          currentVersion: version,
          definitionJson,
          updatedAt: now,
          ...(input.premadeBatch !== undefined ? { premadeBatch: input.premadeBatch } : {}),
        })
        .where(eq(types.id, id))
        .run();
    } else {
      exhibitsDb
        .insert(types)
        .values({
          id,
          slug: def.slug,
          tableName: def.tableName,
          currentVersion: version,
          definitionJson,
          origin: input.origin ?? "custom",
          premadeKey: input.premadeKey ?? null,
          premadeBatch: input.premadeBatch ?? 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
    exhibitsDb
      .insert(typeVersions)
      .values({
        typeId: id,
        version,
        definitionJson,
        opsJson: JSON.stringify(meta.rollbackTo !== undefined ? [{ rollbackTo: meta.rollbackTo }] : ops),
        planJson: JSON.stringify(plan),
        actor: input.actor,
        createdAt: now,
      })
      .run();
  })();

  const row = exhibitsDb.select().from(types).where(eq(types.id, id)).get()!;
  const stored = toStored(row);
  cache.set(id, stored);
  for (const fn of listeners) fn();
  return { type: stored, plan, warnings };
}

export function markForked(typeId: string): void {
  exhibitsDb.update(types).set({ forked: true }).where(eq(types.id, typeId)).run();
  const t = cache.get(typeId);
  if (t) t.forked = true;
}
