import type { FieldDefinition, TypeDefinition } from "@congress/shared-types";
import {
  columnType,
  createJoinTableSql,
  createTableSql,
  dropIndexSql,
  indexSpecs,
  isJoinField,
  quoteIdent,
  sqlString,
} from "./ddl.js";

// Pure: diffs two definitions by field id into SQL. Renames and retires cost
// nothing; a kind change rebuilds the table through te_cast.

export interface Preflight {
  label: string;
  // SELECT returning one row with a numeric `n`.
  sql: string;
  // Blocking checks must return 0; the rest are reported as warnings.
  block: boolean;
}

export interface MigrationPlan {
  steps: string[];
  preflight: Preflight[];
  rebuild: boolean;
}

export function planMigration(before: TypeDefinition | null, after: TypeDefinition): MigrationPlan {
  if (!before) {
    return {
      steps: [
        createTableSql(after),
        ...after.fields.filter(isJoinField).flatMap(createJoinTableSql),
        ...indexSpecs(after).map((i) => i.sql),
      ],
      preflight: [],
      rebuild: false,
    };
  }
  if (before.tableName !== after.tableName) throw new Error("a type's table can't change");

  const t = quoteIdent(after.tableName);
  const beforeById = new Map(before.fields.map((f) => [f.id, f]));
  const added = after.fields.filter((f) => !beforeById.has(f.id));
  const recast = after.fields.filter((f) => {
    const prev = beforeById.get(f.id);
    return prev && !isJoinField(f) && (prev.kind !== f.kind || Boolean(prev.options.integer) !== Boolean(f.options.integer));
  });

  const steps: string[] = [];
  const preflight: Preflight[] = [];

  for (const f of recast) {
    const prev = beforeById.get(f.id)!;
    if (f.kind === "text" || f.kind === "richtext") continue;
    const col = quoteIdent(f.column);
    preflight.push({
      label: `"${f.slug}": values that can't become ${f.kind} will be cleared`,
      sql: `SELECT count(*) AS n FROM ${t} WHERE ${col} IS NOT NULL AND ${col} <> '' AND ${castExpr(prev, f)} IS NULL`,
      block: false,
    });
  }
  for (const f of after.fields) {
    const prev = beforeById.get(f.id);
    if (!prev || f.kind !== "enum" || prev.kind !== "enum") continue;
    const kept = new Set((f.options.options ?? []).map((o) => o.value));
    const removed = (prev.options.options ?? []).map((o) => o.value).filter((v) => !kept.has(v));
    if (removed.length === 0) continue;
    preflight.push({
      label: `"${f.slug}": records still using removed options (${removed.join(", ")})`,
      sql: `SELECT count(*) AS n FROM ${t} WHERE ${quoteIdent(f.column)} IN (${removed.map(sqlString).join(", ")})`,
      block: false,
    });
  }

  const detach = detachSteps(before, after);
  for (const b of removedBindings(before, after)) {
    preflight.push({
      label: `records from ${b.label} will stop syncing and stay as they are`,
      sql: `SELECT count(*) AS n FROM ${t} WHERE "source_binding" = ${sqlString(b.id)}`,
      block: false,
    });
  }

  const rebuild = recast.length > 0;
  if (rebuild) {
    const temp = `${after.tableName}__new`;
    const carried = after.fields.filter((f) => !isJoinField(f) && beforeById.has(f.id));
    const recastIds = new Set(recast.map((f) => f.id));
    const cols = ["id", "created_at", "updated_at", "source_binding", "source_key"].map(quoteIdent);
    const exprs = [...cols];
    for (const f of carried) {
      cols.push(quoteIdent(f.column));
      exprs.push(recastIds.has(f.id) ? castExpr(beforeById.get(f.id)!, f) : quoteIdent(f.column));
    }
    steps.push(
      createTableSql(after, temp),
      `INSERT INTO ${quoteIdent(temp)} (${cols.join(", ")}) SELECT ${exprs.join(", ")} FROM ${t}`,
      `DROP TABLE ${t}`,
      `ALTER TABLE ${quoteIdent(temp)} RENAME TO ${t}`,
      ...added.filter(isJoinField).flatMap(createJoinTableSql),
      ...indexSpecs(after).map((i) => i.sql),
      ...detach
    );
    return { steps, preflight, rebuild };
  }

  for (const f of added) {
    if (isJoinField(f)) steps.push(...createJoinTableSql(f));
    else steps.push(`ALTER TABLE ${t} ADD COLUMN ${quoteIdent(f.column)} ${columnType(f)}`);
  }

  const beforeIdx = new Map(indexSpecs(before).map((i) => [i.name, i.sql]));
  const afterIdx = new Map(indexSpecs(after).map((i) => [i.name, i.sql]));
  for (const [name, sql] of beforeIdx) {
    if (afterIdx.get(name) !== sql) steps.push(dropIndexSql(name));
  }
  for (const [name, sql] of afterIdx) {
    if (beforeIdx.get(name) === sql) continue;
    const f = after.fields.find((x) => name === `ux_${after.tableName}__${x.column}`);
    if (f && beforeById.has(f.id)) preflight.push(duplicateCheck(after.tableName, f));
    steps.push(sql);
  }
  steps.push(...detach);
  return { steps, preflight, rebuild };
}

function removedBindings(before: TypeDefinition, after: TypeDefinition) {
  const kept = new Set(after.bindings.map((b) => b.id));
  return before.bindings.filter((b) => !kept.has(b.id));
}

// A removed binding's records become local: link, shadow and outbox go.
function detachSteps(before: TypeDefinition, after: TypeDefinition): string[] {
  const t = quoteIdent(after.tableName);
  return removedBindings(before, after).flatMap((b) => {
    const mine = `SELECT "id" FROM ${t} WHERE "source_binding" = ${sqlString(b.id)}`;
    return [
      `DELETE FROM "binding_shadows" WHERE "record_id" IN (${mine})`,
      `DELETE FROM "binding_outbox" WHERE "binding_id" = ${sqlString(b.id)} AND "record_id" IN (SELECT "id" FROM ${t})`,
      `UPDATE ${t} SET "source_binding" = NULL, "source_key" = NULL WHERE "source_binding" = ${sqlString(b.id)}`,
    ];
  });
}

function castExpr(from: FieldDefinition, to: FieldDefinition): string {
  const target = JSON.stringify({ kind: to.kind, integer: to.options.integer, options: to.options.options });
  return `te_cast(${quoteIdent(from.column)}, ${sqlString(from.kind)}, ${sqlString(target)})`;
}

function duplicateCheck(table: string, f: FieldDefinition): Preflight {
  const col = quoteIdent(f.column);
  const key = f.kind === "text" ? `lower(${col})` : col;
  const where = f.kind === "text" ? `${col} <> ''` : `${col} IS NOT NULL`;
  return {
    label: `"${f.slug}" has duplicate values, so it can't be unique`,
    sql: `SELECT count(*) AS n FROM (SELECT ${key} FROM ${quoteIdent(table)} WHERE ${where} GROUP BY ${key} HAVING count(*) > 1)`,
    block: true,
  };
}
