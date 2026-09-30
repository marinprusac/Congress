import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult } from "@congress/chamber-kit";
import { askFieldSchema, proposedActionSchema } from "@congress/shared-types";
import { currentRunContext } from "../ai/runContext.js";
import { AskClosedError, AskInvalidError, AskNotFoundError, askQuestion, listAsksForAi, proposeActions, sendMessage, withdrawAsk } from "../ai/asks.js";
import { requestBuilderMode } from "../ai/builder.js";

const urgency = z
  .enum(["quiet", "push"])
  .default("quiet")
  .describe('"push" buzzes the owner\'s phone - only when timing matters. Capped daily and silenced in quiet hours; "quiet" shows in the app and inbox only.');

const futureIso = (what: string) =>
  z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe(`${what} (ISO 8601 with offset, e.g. 2026-09-28T08:00:00+02:00)`);

function toDate(iso: string | undefined, label: string): Date | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (at.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1000) throw new AskInvalidError(`${label} is more than a year away.`);
  return at;
}

async function guarded(fn: () => Promise<unknown> | unknown) {
  try {
    return mcpTextResult(await fn());
  } catch (err) {
    if (err instanceof AskInvalidError) return mcpTextResult({ error: "invalid", message: err.message });
    if (err instanceof AskNotFoundError) return mcpTextResult({ error: "not_found" });
    if (err instanceof AskClosedError) return mcpTextResult({ error: "closed", message: err.message });
    throw err;
  }
}

// Tools the AI uses to reach the owner on its own (see ai/asks.ts).
export function registerAskTools(server: McpServer) {
  server.registerTool(
    "send_message",
    {
      title: "Send Message",
      description:
        "Tell the owner something without needing a reply - a heads-up, a finding, or (with deliverAt) a reminder delivered later. Lands in the current chat thread, or a new one when you're not in a chat. Markdown and exhibit tokens render.",
      inputSchema: {
        title: z.string().max(120).optional().describe("Short headline, shown on the Home card and notification."),
        body: z.string().min(1).max(4000),
        urgency,
        deliverAt: futureIso("Deliver later instead of now"),
        links: z.array(z.string()).max(12).optional().describe("Exhibit tokens to show as chips under the message."),
      },
    },
    ({ title, body, urgency, deliverAt, links }) =>
      guarded(async () => {
        const { message, delivery } = await sendMessage({ title, body, urgency, links, deliverAt: toDate(deliverAt, "deliverAt") }, currentRunContext());
        return { ok: true, messageId: message.id, threadId: message.threadId, delivery };
      })
  );

  server.registerTool(
    "ask_question",
    {
      title: "Ask Question",
      description:
        "Ask the owner for input with a small form you design (1-12 fields). Their answer comes back to you in a follow-up run in the same thread. Prefer one clear question with the fewest fields; use choice/boolean fields when the answers are predictable.",
      inputSchema: {
        title: z.string().min(1).max(120),
        prompt: z.string().min(1).max(2000).describe("The question itself, in Markdown."),
        fields: z.array(askFieldSchema).min(1).max(12),
        submitLabel: z.string().max(40).optional(),
        urgency,
        expiresAt: futureIso("After this the question closes unanswered"),
      },
    },
    ({ title, prompt, fields, submitLabel, urgency, expiresAt }) =>
      guarded(async () => {
        const { message, delivery } = await askQuestion(
          { title, prompt, fields, submitLabel, urgency, expiresAt: toDate(expiresAt, "expiresAt") },
          currentRunContext()
        );
        return { ok: true, messageId: message.id, threadId: message.threadId, delivery };
      })
  );

  server.registerTool(
    "propose_actions",
    {
      title: "Propose Actions",
      description:
        "Propose changes for the owner to approve instead of making them yourself - use it for anything privileged: destructive, irreversible, outward-facing, or something the owner would likely want to veto. On approval Congress calls exactly these tools with exactly these args, in order, then gives you the results.",
      inputSchema: {
        title: z.string().min(1).max(120),
        rationale: z.string().min(1).max(2000).describe("Why, in Markdown - what you noticed and what the changes achieve."),
        actions: z.array(proposedActionSchema).min(1).max(10),
        urgency,
      },
    },
    ({ title, rationale, actions, urgency }) =>
      guarded(async () => {
        const { message, delivery } = await proposeActions({ title, rationale, actions, urgency }, currentRunContext());
        return { ok: true, messageId: message.id, threadId: message.threadId, delivery };
      })
  );

  server.registerTool(
    "request_builder_mode",
    {
      title: "Request Builder Mode",
      description:
        "Ask the owner for builder mode, needed to create or change exhibit types (their fields, feed rules, time triggers) or roll one back. You can't change types without it. The owner grants it for a while in this thread; the builder tools then appear in the follow-up run, and every publish still needs their approval.",
      inputSchema: {
        title: z.string().min(1).max(120).describe('Short headline, e.g. "Add a Book type".'),
        reason: z.string().min(1).max(2000).describe("To the owner, in Markdown: what you want to build or change and why."),
        scope: z.string().max(300).optional().describe("The types you expect to create or change."),
        urgency,
      },
    },
    ({ title, reason, scope, urgency }) =>
      guarded(async () => {
        const { message, delivery } = await requestBuilderMode({ title, reason, scope, urgency }, currentRunContext());
        return { ok: true, messageId: message.id, threadId: message.threadId, delivery };
      })
  );

  server.registerTool(
    "list_open_asks",
    {
      title: "List Open Asks",
      description:
        "Your open questions and proposals, scheduled reminders, and messages sent in the last day, plus how many pushes are left today. Check before asking again, so you never repeat yourself.",
      inputSchema: {},
    },
    () => guarded(() => listAsksForAi())
  );

  server.registerTool(
    "withdraw_ask",
    {
      title: "Withdraw Ask",
      description: "Withdraw an open question or proposal that no longer applies, or cancel a reminder that hasn't been delivered yet.",
      inputSchema: { messageId: z.number().int() },
    },
    ({ messageId }) => guarded(() => ({ ok: true, messageId: withdrawAsk(messageId).id }))
  );
}
