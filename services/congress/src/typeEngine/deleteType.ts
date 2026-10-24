import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { MigrationPlan } from "./planner.js";
import { env } from "../env.js";
import { syncRecord } from "../records.js";
import { recordsDb, recordsSqlite } from "./db/client.js";
import { imports, records, recordTriggerState, types, typeDrafts, typeVersions } from "./db/schema.js";
import { backupDir, snapshot } from "./backups.js";
import { isJoinField, quoteIdent } from "./ddl.js";
import { releaseFiles } from "./files.js";
import { NAMESPACE, notifyWrite, purgeRecords, syncRecordRecord } from "./records.js";
import { forgetType, getType, listTypes, PublishError, recordCount, type PublishPreview, type PublishResult } from "./store.js";

// Deleting a type: its records, table and versions are removed for good (a
// snapshot is taken first, and nightly backups keep 14 days). Nothing is
// pushed to a connector's source and no per-record events are published.

// Active relation fields elsewhere that still link to this type.
function linkingFields(typeId: string): string[] {
  const t = getType(typeId);
  if (!t) return [];
  return listTypes({ includeHidden: true })
    .filter((o) => o.id !== typeId)
    .flatMap((o) =>
      o.definition.fields
        .filter((f) => !f.retired && f.kind === "relation" && f.options.target === t.definition.slug)
        .map((f) => `${o.definition.slug}.${f.slug}`)
    );
}

export function previewDeleteType(typeId: string): PublishPreview {
  const t = getType(typeId);
  if (!t) return { definition: null, changes: [], plan: null, warnings: [], blockers: [], errors: [`no type ${typeId}`] };
  const n = recordCount(typeId);
  const linking = linkingFields(typeId);
  return {
    definition: null,
    changes: [{ area: "type", text: `Delete the type "${t.definition.label}" and its ${n} record${n === 1 ? "" : "s"} permanently` }],
    plan: null,
    warnings: n ? [{ label: `${t.definition.pluralLabel} deleted`, count: n }] : [],
    blockers: [],
    errors: linking.length ? [`other types still link to "${t.definition.slug}" (${linking.join(", ")}); retire those fields first`] : [],
  };
}

export function deleteType(typeId: string, actor: string): PublishResult {
  const t = getType(typeId);
  if (!t) throw new PublishError([`no type ${typeId}`]);
  const errors = previewDeleteType(typeId).errors;
  if (errors.length) throw new PublishError(errors);

  const def = t.definition;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  snapshot(recordsSqlite, join(backupDir(env.RECORDS_DB_PATH), `records-predelete-${def.slug}-${stamp}.sqlite3`));

  let purged!: ReturnType<typeof purgeRecords>;
  recordsSqlite.transaction(() => {
    purged = purgeRecords(t);
    for (const f of def.fields) if (isJoinField(f)) recordsSqlite.exec(`DROP TABLE IF EXISTS ${quoteIdent(f.column)}`);
    recordsSqlite.exec(`DROP TABLE IF EXISTS ${quoteIdent(def.tableName)}`);
    recordsDb.delete(recordTriggerState).where(eq(recordTriggerState.typeId, typeId)).run();
    recordsDb.delete(typeVersions).where(eq(typeVersions.typeId, typeId)).run();
    recordsDb.update(typeDrafts).set({ state: "discarded" }).where(eq(typeDrafts.typeId, typeId)).run();
    recordsDb.delete(records).where(eq(records.typeId, typeId)).run();
    recordsDb.delete(types).where(eq(types.id, typeId)).run();
    // Premade types install again at boot unless they're marked deleted.
    if (t.premadeKey) {
      recordsDb
        .insert(imports)
        .values({ key: `premade-deleted:${t.premadeKey}`, ranAt: new Date(), statsJson: JSON.stringify({ actor }) })
        .onConflictDoNothing()
        .run();
    }
  })();

  releaseFiles(purged.fileIds);
  forgetType(typeId);
  for (const id of purged.ids) syncRecord({ chamber: NAMESPACE, id, type: def.slug, name: "", url: "", deleted: true, outgoingRefs: [] });
  for (const u of purged.unlinked) {
    syncRecordRecord(u.t, u.id);
    notifyWrite(u.t, u.id, undefined, { op: "cleanup", changed: [] });
  }

  const plan: MigrationPlan = { steps: [], preflight: [], rebuild: false };
  return { type: t, plan, warnings: [] };
}
