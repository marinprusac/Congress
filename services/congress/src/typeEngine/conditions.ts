import type { TypeDefinition } from "@congress/shared-types";
import { quoteIdent } from "./ddl.js";
import { encodeValue } from "./codec.js";
import type { Stored } from "./casts.js";

export type Condition = { field: string; value: string | number | boolean | null };

// `and` conditions (field = value, null = unset) as SQL; shared with time triggers.
export function andClauses(def: TypeDefinition, conditions: Condition[] | undefined): { clauses: string[]; params: Stored[] } {
  const clauses: string[] = [];
  const params: Stored[] = [];
  for (const c of conditions ?? []) {
    const f = def.fields.find((x) => x.id === c.field && !x.retired);
    if (!f) throw new Error(`condition field ${c.field} is gone`);
    const encoded = c.value === null ? null : encodeValue(f, c.value);
    if (encoded === null) clauses.push(`${quoteIdent(f.column)} IS NULL`);
    else {
      clauses.push(`${quoteIdent(f.column)} = ?`);
      params.push(encoded);
    }
  }
  return { clauses, params };
}
