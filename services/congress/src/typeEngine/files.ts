import { createHash } from "node:crypto";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import type { FileRef } from "@congress/shared-types";
import { env } from "../env.js";
import { exhibitsDb, exhibitsSqlite } from "./db/client.js";
import { files } from "./db/schema.js";
import { listTypes } from "./store.js";
import { quoteIdent } from "./ddl.js";
import { ulid, ULID_PATTERN } from "./ulid.js";

// Bytes behind `file` fields. Uploads stream to disk while hashing; a file is
// orphaned when no record uses it and deleted after ORPHAN_GRACE_DAYS, the
// backup window, so a restored snapshot still finds its files.

export const ORPHAN_GRACE_DAYS = 14;
const DAY = 86_400_000;

export class FileTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`file is larger than ${maxBytes} bytes`);
  }
}

export function filesDir(): string {
  return resolve(env.EXHIBIT_FILES_DIR);
}

export function filePath(id: string): string {
  if (!ULID_PATTERN.test(id)) throw new Error(`invalid file id ${id}`);
  return join(filesDir(), id);
}

export function cleanName(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim().slice(0, 200);
  return cleaned || "file";
}

export function cleanMime(mime: string | undefined): string {
  const m = (mime ?? "").split(";")[0]!.trim().toLowerCase();
  return /^[a-z0-9][\w.+-]*\/[\w.+-]+$/.test(m) ? m : "application/octet-stream";
}

function toRef(row: typeof files.$inferSelect): FileRef {
  return { id: row.id, name: row.name, mime: row.mime, size: row.size };
}

function insertRow(id: string, sha256: string, name: string, mime: string, size: number, now: Date): FileRef {
  // Unattached until a record write claims it.
  exhibitsDb.insert(files).values({ id, sha256, name, mime, size, createdAt: now, orphanedAt: now }).run();
  return { id, name, mime, size };
}

export async function storeUpload(
  body: ReadableStream<Uint8Array> | null,
  meta: { name: string; mime?: string },
  maxBytes = env.MAX_UPLOAD_BYTES
): Promise<FileRef> {
  mkdirSync(filesDir(), { recursive: true });
  const id = ulid();
  const dest = filePath(id);
  const part = `${dest}.part`;
  const hash = createHash("sha256");
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      size += chunk.length;
      if (size > maxBytes) return done(new FileTooLargeError(maxBytes));
      hash.update(chunk);
      done(null, chunk);
    },
  });
  try {
    const source = body ? Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>) : Readable.from([]);
    await pipeline(source, meter, createWriteStream(part));
    renameSync(part, dest);
  } catch (err) {
    rmSync(part, { force: true });
    throw err;
  }
  return insertRow(id, hash.digest("hex"), cleanName(meta.name), cleanMime(meta.mime), size, new Date());
}

// Imports: copies (never moves) a file already on disk.
export function storeFromPath(src: string, meta: { name: string; mime?: string }, now = new Date()): FileRef {
  mkdirSync(filesDir(), { recursive: true });
  const id = ulid(now.getTime());
  const dest = filePath(id);
  copyFileSync(src, dest);
  const bytes = readFileSync(dest);
  return insertRow(id, createHash("sha256").update(bytes).digest("hex"), cleanName(meta.name), cleanMime(meta.mime), bytes.length, now);
}

export function fileRefs(ids: string[]): Map<string, FileRef> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  return new Map(exhibitsDb.select().from(files).where(inArray(files.id, unique)).all().map((r) => [r.id, toRef(r)]));
}

export function getFile(id: string): (FileRef & { sha256: string }) | null {
  const row = exhibitsDb.select().from(files).where(eq(files.id, id)).get();
  return row ? { ...toRef(row), sha256: row.sha256 } : null;
}

// Whether any record in any type still points at the file.
export function isReferenced(id: string): boolean {
  for (const t of listTypes({ includeHidden: true })) {
    for (const f of t.definition.fields) {
      if (f.kind !== "file") continue;
      const hit = exhibitsSqlite.prepare(`SELECT 1 FROM ${quoteIdent(t.definition.tableName)} WHERE ${quoteIdent(f.column)} = ? LIMIT 1`).get(id);
      if (hit) return true;
    }
  }
  return false;
}

export function attachFiles(ids: string[]): void {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length) exhibitsDb.update(files).set({ orphanedAt: null }).where(inArray(files.id, unique)).run();
}

// Called after a write moved records off these files.
export function releaseFiles(ids: string[], now = new Date()): void {
  const loose = [...new Set(ids.filter(Boolean))].filter((id) => !isReferenced(id));
  if (loose.length) {
    exhibitsDb.update(files).set({ orphanedAt: now }).where(and(inArray(files.id, loose), isNull(files.orphanedAt))).run();
  }
}

// Nightly: deletes files orphaned longer than the grace period.
export function collectOrphans(now = new Date(), graceDays = ORPHAN_GRACE_DAYS): number {
  const cutoff = new Date(now.getTime() - graceDays * DAY);
  const stale = exhibitsDb.select().from(files).where(and(isNotNull(files.orphanedAt), lt(files.orphanedAt, cutoff))).all();
  let removed = 0;
  for (const row of stale) {
    if (isReferenced(row.id)) {
      attachFiles([row.id]);
      continue;
    }
    rmSync(filePath(row.id), { force: true });
    exhibitsDb.delete(files).where(eq(files.id, row.id)).run();
    removed++;
  }
  return removed;
}

export function fileOnDisk(id: string): boolean {
  return existsSync(filePath(id));
}

// Previewable in the browser; everything else downloads.
const INLINE = [/^image\/(png|jpeg|gif|webp|avif|heic|heif)$/, /^application\/pdf$/, /^text\/plain$/, /^video\/(mp4|webm|quicktime)$/, /^audio\//];

export function isInlineMime(mime: string): boolean {
  return INLINE.some((re) => re.test(mime));
}

export function contentDisposition(name: string, inline: boolean): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

// "start-end", "start-" and "-suffix"; null when unsatisfiable.
export function resolveByteRange(header: string, size: number): { start: number; end: number } | null {
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const [, startStr, endStr] = match;
  if (startStr === "" && endStr === "") return null;
  let start: number;
  let end: number;
  if (startStr === "") {
    const suffix = Number(endStr);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(startStr);
    end = endStr === "" ? size - 1 : Math.min(Number(endStr), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end };
}
