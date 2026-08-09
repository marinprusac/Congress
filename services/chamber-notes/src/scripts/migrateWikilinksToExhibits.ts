// One-off data migration: rewrites legacy `[[Title]]` / `[[Title|Alias]]`
// wikilinks (raw note titles) into `[[exhibit:notes:note-<id>|Label]]`
// Exhibit-token references. Run once via `tsx src/scripts/migrateWikilinksToExhibits.ts`.
// Idempotent - already-migrated `[[exhibit:...]]` targets are left untouched,
// so it's safe to re-run.
import { buildExhibitToken, parseExhibitToken } from "@congress/shared-types";
import { closeDb } from "../db/client.js";
import { listNotes, getNote, updateNote } from "../notes.js";

const LEGACY_WIKILINK_PATTERN = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function main() {
  const summaries = await listNotes();
  const titleToId = new Map<string, number>();
  for (const n of summaries) titleToId.set(n.title.toLowerCase(), n.id);

  let migratedCount = 0;

  for (const summary of summaries) {
    const note = await getNote(summary.id);
    if (!note) continue;

    let changed = false;
    const newContent = note.content.replace(LEGACY_WIKILINK_PATTERN, (match, rawTarget: string, rawAlias?: string) => {
      const target = rawTarget.trim();
      if (parseExhibitToken(target)) return match; // already migrated

      const alias = rawAlias?.trim();
      const label = alias || target;
      const resolvedId = titleToId.get(target.toLowerCase());
      const id = resolvedId !== undefined ? `note-${resolvedId}` : `note-missing-${slugify(target)}`;
      const token = buildExhibitToken({ chamber: "notes", id });

      changed = true;
      return `[[${token}|${label}]]`;
    });

    if (changed) {
      await updateNote(summary.id, { content: newContent });
      migratedCount++;
      console.log(`Migrated note ${summary.id} ("${summary.title}")`);
    }
  }

  console.log(`Done. Migrated ${migratedCount} of ${summaries.length} notes.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDb();
  });
