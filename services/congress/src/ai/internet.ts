import { internetRequestPayloadSchema, type AiMessage, type AiUrgency, type InternetRequestPayload } from "@congress/shared-types";
import { db } from "../db/client.js";
import { aiBuilderGrants } from "../db/schema.js";
import { AskInvalidError, createAsk, requireOpenAsk, type AskOrigin } from "./asks.js";
import { activeGrant, closeAsk, openAskInThread } from "./builder.js";
import { updateMessageRow } from "./threads.js";
import { startThreadRun } from "./chat.js";

// Internet mode: the AI may fetch web pages only in a thread the owner
// granted, until the grant expires (same grant table as builder mode).

const ASK_TTL_MS = 24 * 60 * 60 * 1000;

export async function requestInternetMode(input: { title: string; reason: string; urgency?: AiUrgency }, origin: AskOrigin) {
  const grant = activeGrant(origin.threadId, "internet");
  if (grant) throw new AskInvalidError(`Internet access is already granted in this thread until ${grant.expiresAt.toISOString()}.`);
  if (origin.threadId && openAskInThread(origin.threadId, "internet_request").length) {
    throw new AskInvalidError("You already asked for internet access in this thread; wait for the owner.");
  }
  const payload: InternetRequestPayload = { title: input.title, grantedUntil: null, note: null };
  return createAsk(
    { kind: "internet_request", title: input.title, text: input.reason, payload, urgency: input.urgency ?? "quiet", expiresAt: new Date(Date.now() + ASK_TTL_MS) },
    origin
  );
}

export function decideInternetRequest(messageId: number, approve: boolean, opts: { note?: string; grantMinutes?: number } = {}): AiMessage {
  const message = requireOpenAsk(messageId, "internet_request");
  const payload = internetRequestPayloadSchema.parse(message.payload);
  const now = new Date();

  if (!approve) {
    closeAsk(message, opts.note ? `Declined internet access: ${opts.note}` : "Declined internet access.", false);
    const updated = updateMessageRow(messageId, { askState: "rejected", payloadJson: JSON.stringify({ ...payload, note: opts.note ?? null }) });
    startThreadRun(message.threadId, {
      kind: "answer",
      trigger: "decision",
      summaryText: "Declined internet access",
      buildBody: async () =>
        `## The owner declined internet access ("${payload.title}")\n${opts.note ? `Their note: ${opts.note}\n` : ""}Don't try to reach the web. Answer from what you know and say so briefly.`,
    });
    return updated ?? message;
  }

  const minutes = opts.grantMinutes ?? 60;
  const expiresAt = new Date(now.getTime() + minutes * 60_000);
  db.insert(aiBuilderGrants).values({ threadId: message.threadId, kind: "internet", requestMessageId: messageId, grantedAt: now, expiresAt }).run();
  closeAsk(message, `Granted internet access for ${minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}.`, true);
  const updated = updateMessageRow(messageId, {
    askState: "approved",
    payloadJson: JSON.stringify({ ...payload, grantedUntil: expiresAt.toISOString() } satisfies InternetRequestPayload),
  });
  startThreadRun(message.threadId, {
    kind: "answer",
    trigger: "decision",
    summaryText: "Granted internet access",
    buildBody: async () =>
      `## The owner granted internet access ("${payload.title}") until ${expiresAt.toISOString()}\nYour web tools (mcp__web__*) are available in this run. Carry on with what you asked it for: ${message.text}`,
  });
  return updated ?? message;
}
