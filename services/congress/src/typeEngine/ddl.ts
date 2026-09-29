import type { FieldDefinition, TypeDefinition } from "@congress/shared-types";

// Pure SQL text for type tables. Every identifier goes through quoteIdent,
// which only accepts names the engine itself generates.

const IDENT = /^[a-z][a-z0-9_]{0,100}$/;

export function quoteIdent(name: string): string {
  if (!IDENT.test(name)) throw new Error(`invalid identifier: ${JSON.stringify(name)}`);
  return `"${name}"`;
}

export function isJoinField(f: FieldDefinition): boolean {
  return f.kind === "relation" && Boolean(f.options.many);
}

export function columnType(f: FieldDefinition): string {
  switch (f.kind) {
    case "text":
    case "richtext":
      return "TEXT NOT NULL DEFAULT ''";
    case "boolean":
      return "INTEGER NOT NULL DEFAULT 0";
    case "datetime":
      return "INTEGER";
    case "number":
      return f.options.integer ? "INTEGER" : "REAL";
    case "enum":
    case "relation":
      return "TEXT";
  }
}

export function createTableSql(def: TypeDefinition, tableName = def.tableName): string {
  const cols = [
    `"id" TEXT PRIMARY KEY NOT NULL`,
    `"created_at" INTEGER NOT NULL`,
    `"updated_at" INTEGER NOT NULL`,
    `"source_binding" TEXT`,
    `"source_key" TEXT`,
    ...def.fields.filter((f) => !isJoinField(f)).map((f) => `${quoteIdent(f.column)} ${columnType(f)}`),
  ];
  return `CREATE TABLE ${quoteIdent(tableName)} (${cols.join(", ")})`;
}

export function createJoinTableSql(f: FieldDefinition): string[] {
  const t = quoteIdent(f.column);
  return [
    `CREATE TABLE ${t} ("from_id" TEXT NOT NULL, "to_id" TEXT NOT NULL, "position" INTEGER NOT NULL DEFAULT 0, PRIMARY KEY ("from_id", "to_id"))`,
    `CREATE INDEX ${quoteIdent(`ix_${f.column}__to`)} ON ${t} ("to_id")`,
  ];
}

export interface IndexSpec {
  name: string;
  sql: string;
}

// The full index set a definition implies; the planner diffs these by name.
export function indexSpecs(def: TypeDefinition): IndexSpec[] {
  const t = def.tableName;
  const specs: IndexSpec[] = [
    { name: `ix_${t}__updated_at`, sql: `CREATE INDEX ${quoteIdent(`ix_${t}__updated_at`)} ON ${quoteIdent(t)} ("updated_at")` },
    {
      name: `ux_${t}__source`,
      sql: `CREATE UNIQUE INDEX ${quoteIdent(`ux_${t}__source`)} ON ${quoteIdent(t)} ("source_binding", "source_key") WHERE "source_binding" IS NOT NULL`,
    },
  ];
  for (const f of def.fields) {
    if (f.retired || isJoinField(f)) continue;
    const col = quoteIdent(f.column);
    if (f.options.unique) {
      const name = `ux_${t}__${f.column}`;
      const textual = f.kind === "text";
      specs.push({
        name,
        sql: `CREATE UNIQUE INDEX ${quoteIdent(name)} ON ${quoteIdent(t)} (${col}${textual ? " COLLATE NOCASE" : ""}) WHERE ${textual ? `${col} <> ''` : `${col} IS NOT NULL`}`,
      });
    } else if (f.options.indexed || f.kind === "relation") {
      const name = `ix_${t}__${f.column}`;
      specs.push({ name, sql: `CREATE INDEX ${quoteIdent(name)} ON ${quoteIdent(t)} (${col})` });
    }
  }
  return specs;
}

export function dropIndexSql(name: string): string {
  return `DROP INDEX IF EXISTS ${quoteIdent(name)}`;
}

export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
