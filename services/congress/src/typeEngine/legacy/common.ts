import { isAbsolute, resolve } from "node:path";
import { eq, like } from "drizzle-orm";
import { db } from "../../db/client.js";
import { aiTracking, eventSettings, exhibitCache, exhibitRefs } from "../../db/schema.js";
import { readChamberEnv } from "../../chambers/loader.js";
import { exhibitsDb } from "../db/client.js";
import { imports } from "../db/schema.js";
import { aliasesForIds } from "../aliases.js";

// Shared by the one-time Chamber -> type imports (tasks, documents; notes'
// was the first, see git history). Delete with them once they've run.

export interface LegacySpec {
  key: string;
  // The retired Chamber and its exhibit id prefix ("tasks", "task-").
  chamber: string;
  idPrefix: string;
  // tasks.X -> task.X, with payload fields renamed in templates.
  eventPrefix: string;
  payloadRenames: Record<string, string>;
}

export interface CoreRewriteStats {
  exhibitRefsRewritten: number;
  eventSettingsCopied: number;
  trackingUpdated: number;
}

export function alreadyImported(key: string): boolean {
  return Boolean(exhibitsDb.select().from(imports).where(eq(imports.key, key)).get());
}

export function markImported(key: string, stats: object): void {
  exhibitsDb
    .insert(imports)
    .values({ key, ranAt: new Date(), statsJson: JSON.stringify(stats) })
    .onConflictDoUpdate({ target: imports.key, set: { statsJson: JSON.stringify(stats) } })
    .run();
}

// A Chamber's own .env path setting, resolved against its folder.
export function chamberPath(dir: string, key: string, fallback: string): string {
  const configured = readChamberEnv(dir)[key] ?? fallback;
  return isAbsolute(configured) ? configured : resolve(dir, configured);
}

// A manual ref's target: this import's own ids map directly, other retired
// Chambers' ids through their aliases, anything else stays as it is.
export function canonicalTarget(target: string, spec: LegacySpec, idFor: Map<number, string>): string {
  if (target.startsWith(spec.idPrefix)) {
    const own = idFor.get(Number(target.slice(spec.idPrefix.length)));
    if (own) return own;
  }
  return aliasesForIds([target]).get(target) ?? target;
}

export function rewriteTemplate(template: string | null, renames: Record<string, string>): string | null {
  if (!template) return template;
  let out = template;
  for (const [from, to] of Object.entries(renames)) out = out.replaceAll(`payload.${from}`, `payload.${to}`);
  return out;
}

// Congress's own DB: refs pointing at the old ids, the old exhibit cache,
// event settings (copied to the new names) and the AI's watched events.
export function rewriteCoreDb(spec: LegacySpec, idFor: Map<number, string>): CoreRewriteStats {
  const stats: CoreRewriteStats = { exhibitRefsRewritten: 0, eventSettingsCopied: 0, trackingUpdated: 0 };
  const oldPrefix = `${spec.chamber}.`;
  db.transaction((tx) => {
    // The Chamber's own rows are rebuilt by the caller's re-sync.
    tx.delete(exhibitRefs).where(eq(exhibitRefs.sourceChamber, spec.chamber)).run();
    for (const [legacy, id] of idFor) {
      const res = tx.update(exhibitRefs).set({ targetId: id }).where(eq(exhibitRefs.targetId, `${spec.idPrefix}${legacy}`)).run();
      stats.exhibitRefsRewritten += res.changes;
    }
    tx.delete(exhibitCache).where(eq(exhibitCache.chamber, spec.chamber)).run();

    for (const row of tx.select().from(eventSettings).where(like(eventSettings.eventType, `${oldPrefix}%`)).all()) {
      const target = `${spec.eventPrefix}.${row.eventType.slice(oldPrefix.length)}`;
      const config = {
        recordToHistory: row.recordToHistory,
        historyRetentionMs: row.historyRetentionMs,
        notify: row.notify,
        notifyTitleTemplate: rewriteTemplate(row.notifyTitleTemplate, spec.payloadRenames),
        notifyBodyTemplate: rewriteTemplate(row.notifyBodyTemplate, spec.payloadRenames),
        notifyUrlTemplate: rewriteTemplate(row.notifyUrlTemplate, spec.payloadRenames),
        notifyDedupeKeyTemplate: rewriteTemplate(row.notifyDedupeKeyTemplate, spec.payloadRenames),
        updatedAt: new Date(),
      };
      const existing = tx.select().from(eventSettings).where(eq(eventSettings.eventType, target)).get();
      if (existing) tx.update(eventSettings).set(config).where(eq(eventSettings.eventType, target)).run();
      else tx.insert(eventSettings).values({ ...config, eventType: target, chamber: "types", label: row.label, createdAt: new Date() }).run();
      stats.eventSettingsCopied++;
    }

    const watched = new RegExp(`"${spec.chamber}\\.([a-z_]+)"`, "g");
    for (const item of tx.select().from(aiTracking).where(like(aiTracking.watchEventsJson, `%"${oldPrefix}%`)).all()) {
      tx.update(aiTracking)
        .set({ watchEventsJson: item.watchEventsJson.replace(watched, `"${spec.eventPrefix}.$1"`) })
        .where(eq(aiTracking.id, item.id))
        .run();
      stats.trackingUpdated++;
    }
  });
  return stats;
}
