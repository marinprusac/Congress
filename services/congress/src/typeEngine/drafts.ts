import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { operationSchema, type Operation } from "@congress/shared-types";
import { exhibitsDb } from "./db/client.js";
import { typeDrafts } from "./db/schema.js";
import {
  getType,
  getTypeBySlug,
  markForked,
  previewPublish,
  previewRollback,
  publish,
  PublishError,
  rollback,
  type PublishPreview,
  type PublishResult,
} from "./store.js";
import { ulid } from "./ulid.js";

// Builder mode's drafts: ops (or a rollback) collected against a base version,
// previewed, and published only as a whole.

export class DraftError extends Error {}

type DraftRow = typeof typeDrafts.$inferSelect;

export interface Draft {
  id: string;
  threadId: number;
  typeId: string | null;
  // The type's current slug, or the slug a new type will get.
  slug: string | null;
  baseVersion: number;
  rollbackTo: number | null;
  ops: Operation[];
  state: DraftRow["state"];
  // The type changed since the draft started; it can't publish.
  stale: boolean;
  problems: string[];
  publishedVersion: number | null;
}

function toDraft(row: DraftRow): Draft {
  const ops = JSON.parse(row.opsJson) as Operation[];
  const type = row.typeId ? getType(row.typeId) : undefined;
  const created = ops.find((o) => o.op === "create_type");
  return {
    id: row.id,
    threadId: row.threadId,
    typeId: row.typeId,
    slug: type?.definition.slug ?? (created?.op === "create_type" ? created.slug : null),
    baseVersion: row.baseVersion,
    rollbackTo: row.rollbackTo,
    ops,
    state: row.state,
    stale: row.state === "open" && Boolean(row.typeId) && type?.version !== row.baseVersion,
    problems: row.problemsJson ? (JSON.parse(row.problemsJson) as string[]) : [],
    publishedVersion: row.publishedVersion,
  };
}

function row(id: string): DraftRow {
  const r = exhibitsDb.select().from(typeDrafts).where(eq(typeDrafts.id, id)).get();
  if (!r) throw new DraftError(`no draft ${id}`);
  return r;
}

export function getDraft(id: string): Draft {
  return toDraft(row(id));
}

export function listDrafts(opts: { threadId?: number; openOnly?: boolean } = {}): Draft[] {
  const conds = [];
  if (opts.threadId !== undefined) conds.push(eq(typeDrafts.threadId, opts.threadId));
  if (opts.openOnly) conds.push(eq(typeDrafts.state, "open"));
  return exhibitsDb
    .select()
    .from(typeDrafts)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(typeDrafts.createdAt))
    .all()
    .map(toDraft);
}

// Opens a draft for a new type (no slug), an existing type, or a rollback of one.
// An existing type's open draft in the same thread is reused.
export function startDraft(input: { threadId: number; slug?: string; rollbackTo?: number }): Draft {
  if (input.rollbackTo !== undefined && !input.slug) throw new DraftError("a rollback needs the type's slug");
  const type = input.slug ? getTypeBySlug(input.slug) : undefined;
  if (input.slug && !type) throw new DraftError(`no type "${input.slug}"`);

  if (type) {
    const open = listDrafts({ threadId: input.threadId, openOnly: true }).find((d) => d.typeId === type.id);
    if (open && open.rollbackTo === (input.rollbackTo ?? null)) return open;
    if (open) throw new DraftError(`draft ${open.id} is already open for "${type.definition.slug}"; discard it first`);
    if (input.rollbackTo !== undefined && (input.rollbackTo < 1 || input.rollbackTo >= type.version)) {
      throw new DraftError(`"${type.definition.slug}" has no earlier version ${input.rollbackTo}`);
    }
  }

  const now = new Date();
  const id = `drf_${ulid()}`;
  exhibitsDb
    .insert(typeDrafts)
    .values({
      id,
      typeId: type?.id ?? null,
      baseVersion: type?.version ?? 0,
      rollbackTo: input.rollbackTo ?? null,
      opsJson: "[]",
      threadId: input.threadId,
      state: "open",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return getDraft(id);
}

function openRow(id: string): DraftRow {
  const r = row(id);
  if (r.state !== "open") throw new DraftError(`draft ${id} is ${r.state}`);
  return r;
}

export function setDraftOps(id: string, ops: unknown[], mode: "append" | "replace"): Draft {
  const r = openRow(id);
  if (r.rollbackTo !== null) throw new DraftError("a rollback draft takes no ops");
  const parsed = ops.map((op, i) => {
    const res = operationSchema.safeParse(op);
    if (!res.success) throw new DraftError(`op #${i + 1}: ${res.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
    return res.data;
  });
  const next = mode === "append" ? [...(JSON.parse(r.opsJson) as Operation[]), ...parsed] : parsed;
  if (next.length > 100) throw new DraftError("a draft holds at most 100 ops");
  exhibitsDb.update(typeDrafts).set({ opsJson: JSON.stringify(next), problemsJson: null, updatedAt: new Date() }).where(eq(typeDrafts.id, id)).run();
  return getDraft(id);
}

export function discardDraft(id: string): Draft {
  openRow(id);
  exhibitsDb.update(typeDrafts).set({ state: "discarded", updatedAt: new Date() }).where(eq(typeDrafts.id, id)).run();
  return getDraft(id);
}

export function previewDraft(id: string): PublishPreview & { draft: Draft } {
  const draft = getDraft(id);
  const base = draft.rollbackTo !== null ? previewRollback(draft.typeId!, draft.rollbackTo) : previewPublish(draft.typeId ?? undefined, draft.ops);
  const errors = [...base.errors];
  if (draft.stale) errors.unshift("the type changed since this draft started; start a new draft");
  if (draft.rollbackTo === null && !draft.ops.length) errors.push("the draft has no ops");
  return { ...base, errors, draft };
}

// What the owner approved: a publish must match it exactly.
export function draftHash(draft: Draft): string {
  const key = JSON.stringify([draft.id, draft.typeId, draft.baseVersion, draft.rollbackTo, draft.ops]);
  return createHash("sha256").update(key).digest("hex");
}

export function publishDraft(id: string, actor: string, expectedHash?: string): PublishResult {
  const draft = toDraft(openRow(id));
  if (draft.stale) throw new DraftError("the type changed since this draft started");
  if (expectedHash && draftHash(draft) !== expectedHash) throw new DraftError("the draft changed after it was reviewed");
  if (draft.rollbackTo === null && !draft.ops.length) throw new DraftError("the draft has no ops");

  let result: PublishResult;
  try {
    result =
      draft.rollbackTo !== null
        ? rollback(draft.typeId!, draft.rollbackTo, actor)
        : publish({ typeId: draft.typeId ?? undefined, ops: draft.ops, actor });
  } catch (err) {
    if (err instanceof PublishError) {
      exhibitsDb.update(typeDrafts).set({ problemsJson: JSON.stringify(err.problems), updatedAt: new Date() }).where(eq(typeDrafts.id, id)).run();
    }
    throw err;
  }
  // An owner-approved change to a premade type means its later batches no longer apply.
  if (result.type.origin === "premade" && !result.type.forked) markForked(result.type.id);
  exhibitsDb
    .update(typeDrafts)
    .set({ state: "published", typeId: result.type.id, publishedVersion: result.type.version, problemsJson: null, updatedAt: new Date() })
    .where(eq(typeDrafts.id, id))
    .run();
  return result;
}
