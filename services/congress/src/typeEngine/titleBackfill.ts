import { eq } from "drizzle-orm";
import { withTitlePrefix } from "@congress/shared-types";
import { recordsDb, recordsSqlite } from "./db/client.js";
import { imports } from "./db/schema.js";
import { quoteIdent } from "./ddl.js";
import { syncRecordRecord } from "./records.js";
import { listTypes } from "./store.js";

const KEY = "title-prefix-backfill";

// Once: give owner-authored records written before typed titles ("Note: ...")
// the prefix. Source-synced rows keep their titles; updated_at is untouched.
export function backfillTitlePrefixes(): number {
  if (recordsDb.select().from(imports).where(eq(imports.key, KEY)).get()) return 0;
  let changed = 0;
  for (const t of listTypes()) {
    const def = t.definition;
    const f = def.fields.find((x) => x.id === def.titleField);
    if (!f || f.kind !== "text") continue;
    const table = quoteIdent(def.tableName);
    const col = quoteIdent(f.column);
    const rows = recordsSqlite.prepare(`SELECT "id", ${col} AS title FROM ${table} WHERE "source_binding" IS NULL`).all() as { id: string; title: string | null }[];
    const update = recordsSqlite.prepare(`UPDATE ${table} SET ${col} = ? WHERE "id" = ?`);
    for (const { id, title } of rows) {
      const next = withTitlePrefix(def.label, title ?? "");
      if (!next || next === title) continue;
      update.run(next, id);
      syncRecordRecord(t, id);
      changed++;
    }
  }
  recordsDb.insert(imports).values({ key: KEY, ranAt: new Date(), statsJson: JSON.stringify({ changed }) }).run();
  return changed;
}
