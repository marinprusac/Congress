import { and, desc, eq, gt, isNull } from "drizzle-orm";
import {
  builderRequestPayloadSchema,
  typePublishPayloadSchema,
  type AiMessage,
  type AiUrgency,
  type BuilderRequestPayload,
  type TypePublishPayload,
} from "@congress/shared-types";
import { db } from "../db/client.js";
import { aiBuilderGrants, aiMessages } from "../db/schema.js";
import { dismissNotificationByKey } from "../notifications.js";
import { publishEvent } from "../events.js";
import { DraftError, draftHash, getDraft, previewDraft, publishDraft } from "../typeEngine/drafts.js";
import { PublishError } from "../typeEngine/store.js";
import { AskInvalidError, createAsk, dedupeKey, requireOpenAsk, type AskOrigin } from "./asks.js";
import { insertMessage, updateMessageRow } from "./threads.js";
import { notifyThreadUpdated } from "./runStream.js";
import { startThreadRun } from "./chat.js";

// Builder mode: the AI may draft type changes only in a thread the owner
// granted, until the grant expires; every publish needs its own approval.

export const BUILDER_ACTOR = "ai-builder";
const ASK_TTL_MS = 24 * 60 * 60 * 1000;

export interface BuilderGrant {
  id: number;
  threadId: number;
  expiresAt: Date;
}

export type GrantKind = "builder" | "internet";

export function activeGrant(threadId: number | null, kind: GrantKind = "builder", now = new Date()): BuilderGrant | null {
  if (!threadId) return null;
  const row = db
    .select()
    .from(aiBuilderGrants)
    .where(and(eq(aiBuilderGrants.threadId, threadId), eq(aiBuilderGrants.kind, kind), isNull(aiBuilderGrants.revokedAt), gt(aiBuilderGrants.expiresAt, now)))
    .orderBy(desc(aiBuilderGrants.expiresAt))
    .limit(1)
    .get();
  return row ? { id: row.id, threadId: row.threadId, expiresAt: row.expiresAt } : null;
}

export function openAskInThread(threadId: number, kind: "builder_request" | "internet_request" | "type_publish") {
  return db
    .select()
    .from(aiMessages)
    .where(and(eq(aiMessages.threadId, threadId), eq(aiMessages.kind, kind), eq(aiMessages.askState, "open")))
    .all();
}

export async function requestBuilderMode(input: { title: string; reason: string; scope?: string | null; urgency?: AiUrgency }, origin: AskOrigin) {
  const grant = activeGrant(origin.threadId);
  if (grant) throw new AskInvalidError(`Builder mode is already granted in this thread until ${grant.expiresAt.toISOString()}.`);
  if (origin.threadId && openAskInThread(origin.threadId, "builder_request").length) {
    throw new AskInvalidError("You already asked for builder mode in this thread; wait for the owner.");
  }
  const payload: BuilderRequestPayload = { title: input.title, scope: input.scope ?? null, grantedUntil: null, note: null };
  return createAsk(
    {
      kind: "builder_request",
      title: input.title,
      text: input.reason,
      payload,
      urgency: input.urgency ?? "quiet",
      expiresAt: new Date(Date.now() + ASK_TTL_MS),
    },
    origin
  );
}

export function closeAsk(message: AiMessage, decisionText: string, approve: boolean) {
  dismissNotificationByKey("congress", dedupeKey(message.id));
  insertMessage({ threadId: message.threadId, role: "user", kind: "decision", text: decisionText, payload: { askId: message.id, approve } });
}

export function decideBuilderRequest(messageId: number, approve: boolean, opts: { note?: string; grantMinutes?: number } = {}): AiMessage {
  const message = requireOpenAsk(messageId, "builder_request");
  const payload = builderRequestPayloadSchema.parse(message.payload);
  const now = new Date();

  if (!approve) {
    closeAsk(message, opts.note ? `Declined builder mode: ${opts.note}` : "Declined builder mode.", false);
    const updated = updateMessageRow(messageId, { askState: "rejected", payloadJson: JSON.stringify({ ...payload, note: opts.note ?? null }) });
    startThreadRun(message.threadId, {
      kind: "answer",
      trigger: "decision",
      summaryText: "Declined builder mode",
      buildBody: async () =>
        `## The owner declined builder mode ("${payload.title}")\n${opts.note ? `Their note: ${opts.note}\n` : ""}Don't change any exhibit type. Acknowledge briefly.`,
    });
    return updated ?? message;
  }

  const minutes = opts.grantMinutes ?? 60;
  const expiresAt = new Date(now.getTime() + minutes * 60_000);
  db.insert(aiBuilderGrants).values({ threadId: message.threadId, requestMessageId: messageId, grantedAt: now, expiresAt }).run();
  closeAsk(message, `Granted builder mode for ${minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}.`, true);
  const updated = updateMessageRow(messageId, {
    askState: "approved",
    payloadJson: JSON.stringify({ ...payload, grantedUntil: expiresAt.toISOString() } satisfies BuilderRequestPayload),
  });
  startThreadRun(message.threadId, {
    kind: "answer",
    trigger: "decision",
    summaryText: "Granted builder mode",
    buildBody: async () =>
      `## The owner granted builder mode ("${payload.title}") until ${expiresAt.toISOString()}\nYour builder tools (mcp__builder__*) are available in this run. Carry on with what you asked it for: ${message.text}\nDraft the change, preview it, then request_publish; the owner approves each publish.`,
  });
  return updated ?? message;
}

// The owner ends builder mode early; open drafts stay until discarded.
export function endGrant(threadId: number, kind: GrantKind = "builder", now = new Date()): boolean {
  const grant = activeGrant(threadId, kind, now);
  if (!grant) return false;
  db
    .update(aiBuilderGrants)
    .set({ revokedAt: now })
    .where(and(eq(aiBuilderGrants.threadId, threadId), eq(aiBuilderGrants.kind, kind), isNull(aiBuilderGrants.revokedAt)))
    .run();
  insertMessage({ threadId, role: "system", kind: "notice", text: kind === "internet" ? "Internet access ended." : "Builder mode ended." });
  notifyThreadUpdated(threadId);
  return true;
}

export async function requestPublish(input: { draftId: string; title: string; summary: string; urgency?: AiUrgency }, origin: AskOrigin) {
  if (!activeGrant(origin.threadId)) throw new AskInvalidError("Builder mode isn't granted in this thread.");
  let draft;
  try {
    draft = getDraft(input.draftId);
  } catch (err) {
    if (err instanceof DraftError) throw new AskInvalidError(err.message);
    throw err;
  }
  if (draft.threadId !== origin.threadId) throw new AskInvalidError("That draft belongs to another thread.");
  if (draft.state !== "open") throw new AskInvalidError(`That draft is ${draft.state}.`);
  const preview = previewDraft(draft.id);
  const problems = [...preview.errors, ...preview.blockers.map((b) => `${b.label} (${b.count})`)];
  if (problems.length || !preview.definition) throw new AskInvalidError(`Fix the draft first: ${problems.join("; ")}`);
  const pending = openAskInThread(draft.threadId, "type_publish").filter((m) => {
    const p = typePublishPayloadSchema.safeParse(JSON.parse(m.payloadJson ?? "null"));
    return p.success && p.data.draftId === draft.id;
  });
  if (pending.length) throw new AskInvalidError("That draft is already waiting for the owner's review.");

  const payload: TypePublishPayload = {
    title: input.title,
    draftId: draft.id,
    hash: draftHash(draft),
    typeLabel: preview.definition.label,
    isNew: !draft.typeId,
    rollbackTo: draft.rollbackTo,
    changes: preview.changes,
    warnings: preview.warnings,
    rebuild: preview.plan?.rebuild ?? false,
    publishedVersion: null,
    error: null,
    note: null,
  };
  return createAsk(
    { kind: "type_publish", title: input.title, text: input.summary, payload, urgency: input.urgency ?? "quiet", expiresAt: new Date(Date.now() + ASK_TTL_MS) },
    origin
  );
}

export function decidePublish(messageId: number, approve: boolean, note?: string): AiMessage {
  const message = requireOpenAsk(messageId, "type_publish");
  const payload = typePublishPayloadSchema.parse(message.payload);

  if (!approve) {
    closeAsk(message, note ? `Rejected: ${note}` : "Rejected.", false);
    const updated = updateMessageRow(messageId, { askState: "rejected", payloadJson: JSON.stringify({ ...payload, note: note ?? null }) });
    startThreadRun(message.threadId, {
      kind: "answer",
      trigger: "decision",
      summaryText: `Rejected: ${payload.title}`,
      buildBody: async () =>
        `## The owner rejected publishing "${payload.title}"\n${note ? `Their note: ${note}\n` : ""}Nothing was published. The draft ${payload.draftId} is still open: revise it and ask again, or discard it.`,
    });
    return updated ?? message;
  }

  closeAsk(message, "Approved.", true);
  let result: { version: number; slug: string } | null = null;
  let error: string | null = null;
  try {
    // Exactly what was reviewed: publishDraft refuses if the draft changed.
    const { type } = publishDraft(payload.draftId, BUILDER_ACTOR, payload.hash);
    result = { version: type.version, slug: type.definition.slug };
  } catch (err) {
    if (!(err instanceof DraftError || err instanceof PublishError)) throw err;
    error = err.message;
  }
  const updated = updateMessageRow(messageId, {
    askState: result ? "executed" : "failed",
    payloadJson: JSON.stringify({ ...payload, publishedVersion: result?.version ?? null, error } satisfies TypePublishPayload),
  });
  notifyThreadUpdated(message.threadId);
  if (result) {
    publishEvent({
      chamber: "congress",
      type: "congress.type_published",
      actor: "congress",
      payload: { slug: result.slug, label: payload.typeLabel, version: result.version, summary: payload.title },
    });
  }
  startThreadRun(message.threadId, {
    kind: "answer",
    trigger: "decision",
    summaryText: `Approved: ${payload.title}`,
    buildBody: async () =>
      result
        ? `## The owner approved "${payload.title}"\nCongress published it: type "${result.slug}" is now version ${result.version}. Confirm briefly what changed, in plain words (no tool names); the owner adds records from the + button or by asking you.`
        : `## The owner approved "${payload.title}", but publishing failed\n${error}\nExplain briefly; fix the draft (or start a new one) and ask again if it still makes sense.`,
  });
  return updated ?? message;
}
