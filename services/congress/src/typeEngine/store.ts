import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { Operation, TypeDefinition, TypeSummary } from "@congress/shared-types";
import { typeDefinitionSchema } from "@congress/shared-types";
import { env } from "../env.js";
import { exhibitsDb, exhibitsSqlite } from "./db/client.js";
import { types, typeVersions } from "./db/schema.js";
import { applyOperations, OperationError, rollbackDefinition } from "./operations.js";
import { planMigration, type MigrationPlan } from "./planner.js";
import { isJoinField } from "./ddl.js";
import { backupDir, snapshot } from "./backups.js";
import { ulid } from "./ulid.js";

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

export function publish(input: PublishInput): PublishResult {
  ensureLoaded();
  const current = input.typeId ? cache.get(input.typeId) : undefined;
  if (input.typeId && !current) throw new PublishError([`no type ${input.typeId}`]);
  let applied: ReturnType<typeof applyOperations>;
  try {
    applied = applyOperations(current?.definition ?? null, input.ops, { takenTables: tablesUsedExcept(input.typeId) });
  } catch (err) {
    if (err instanceof OperationError) throw new PublishError([err.message]);
    throw err;
  }
  const { def, errors } = applied;
  if (errors.length) throw new PublishError(errors);
  return commit(current, def, input.ops, input);
}

// Restores an earlier version's definition; fields added since stay, retired.
export function rollback(typeId: string, toVersion: number, actor: string): PublishResult {
  ensureLoaded();
  const current = cache.get(typeId);
  if (!current) throw new PublishError([`no type ${typeId}`]);
  const row = exhibitsDb.select().from(typeVersions).where(eq(typeVersions.typeId, typeId)).all().find((v) => v.version === toVersion);
  if (!row) throw new PublishError([`no version ${toVersion}`]);
  const target = typeDefinitionSchema.parse(JSON.parse(row.definitionJson));
  const def = rollbackDefinition(current.definition, target);
  return commit(current, def, [], { actor, ops: [] }, { rollbackTo: toVersion });
}

export function listVersions(typeId: string) {
  return exhibitsDb
    .select({ version: typeVersions.version, actor: typeVersions.actor, createdAt: typeVersions.createdAt, opsJson: typeVersions.opsJson })
    .from(typeVersions)
    .where(eq(typeVersions.typeId, typeId))
    .all()
    .sort((a, b) => b.version - a.version)
    .map((v) => ({ version: v.version, actor: v.actor, createdAt: v.createdAt.toISOString(), ops: JSON.parse(v.opsJson) as unknown }));
}

function commit(
  current: StoredType | undefined,
  def: TypeDefinition,
  ops: Operation[],
  input: PublishInput,
  meta: { rollbackTo?: number } = {}
): PublishResult {
  const clash = [...cache.values()].find((t) => t.id !== current?.id && t.definition.slug === def.slug);
  if (clash) throw new PublishError([`a type "${def.slug}" already exists`]);

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
    const blocking: string[] = [];
    for (const check of plan.preflight) {
      const n = Number((exhibitsSqlite.prepare(check.sql).get() as { n: number }).n);
      if (n === 0) continue;
      if (check.block) blocking.push(`${check.label} (${n})`);
      else warnings.push(`${check.label} (${n})`);
    }
    if (blocking.length) throw new PublishError(blocking);
    for (const step of plan.steps) exhibitsSqlite.exec(step);

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
