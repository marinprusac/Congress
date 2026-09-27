import { z } from "zod";

// AI-authored asks: a message (optionally delayed = a reminder), a question
// with a form the AI builds itself, and a proposal of changes the owner
// approves. Stored as ai_messages rows (kind + payload + askState).

const fieldBase = {
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/, "key must be a short identifier (letters, digits, _)"),
  label: z.string().min(1).max(120),
  required: z.boolean().default(false),
  help: z.string().max(200).optional(),
};

const optionSchema = z.object({ value: z.string().min(1).max(80), label: z.string().min(1).max(80) });

export const askFieldSchema = z.discriminatedUnion("type", [
  z.object({ ...fieldBase, type: z.literal("text"), default: z.string().max(500).optional(), placeholder: z.string().max(80).optional() }),
  z.object({ ...fieldBase, type: z.literal("longtext"), default: z.string().max(4000).optional(), placeholder: z.string().max(80).optional() }),
  z.object({
    ...fieldBase,
    type: z.literal("number"),
    default: z.number().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    unit: z.string().max(16).optional(),
  }),
  z.object({ ...fieldBase, type: z.literal("boolean"), default: z.boolean().optional() }),
  z.object({ ...fieldBase, type: z.literal("choice"), options: z.array(optionSchema).min(2).max(12), default: z.string().optional() }),
  z.object({ ...fieldBase, type: z.literal("multichoice"), options: z.array(optionSchema).min(2).max(12), default: z.array(z.string()).optional() }),
  z.object({ ...fieldBase, type: z.literal("date"), default: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  z.object({ ...fieldBase, type: z.literal("datetime"), default: z.string().optional() }),
  z.object({ ...fieldBase, type: z.literal("exhibit") }),
]);
export type AskField = z.infer<typeof askFieldSchema>;
export type AskFieldInput = z.input<typeof askFieldSchema>;

export const askFieldsSchema = z
  .array(askFieldSchema)
  .min(1)
  .max(12)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    fields.forEach((f, i) => {
      if (seen.has(f.key)) ctx.addIssue({ code: "custom", path: [i, "key"], message: `duplicate key "${f.key}"` });
      seen.add(f.key);
      if ((f.type === "choice" || f.type === "multichoice") && new Set(f.options.map((o) => o.value)).size !== f.options.length) {
        ctx.addIssue({ code: "custom", path: [i, "options"], message: "option values must be unique" });
      }
      if (f.type === "number" && f.min !== undefined && f.max !== undefined && f.min > f.max) {
        ctx.addIssue({ code: "custom", path: [i, "min"], message: "min is greater than max" });
      }
    });
  });

export type AskAnswerValue = string | number | boolean | string[] | null;
export type AskAnswers = Record<string, AskAnswerValue>;

// A schema for one question's answers, built from its own fields. Missing
// optional fields come back as null.
export function answerSchemaFor(fields: AskField[]) {
  const shape: Record<string, z.ZodType<AskAnswerValue>> = {};
  for (const f of fields) {
    let s: z.ZodType<AskAnswerValue>;
    switch (f.type) {
      case "text":
        s = z.string().trim().max(500);
        break;
      case "longtext":
        s = z.string().trim().max(4000);
        break;
      case "number": {
        let n = z.number().finite();
        if (f.min !== undefined) n = n.min(f.min);
        if (f.max !== undefined) n = n.max(f.max);
        s = n;
        break;
      }
      case "boolean":
        s = z.boolean();
        break;
      case "choice":
        s = z.enum(f.options.map((o) => o.value) as [string, ...string[]]);
        break;
      case "multichoice":
        s = z.array(z.enum(f.options.map((o) => o.value) as [string, ...string[]])).max(f.options.length);
        break;
      case "date":
        s = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected a date");
        break;
      case "datetime":
        s = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "expected a date and time");
        break;
      case "exhibit":
        s = z.string().regex(/^\[\[exhibit:[^\]]+\]\]$/, "expected an exhibit");
        break;
    }
    // An empty string/list counts as "not answered".
    const required = f.required && f.type !== "boolean";
    const empty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
    shape[f.key] = z.preprocess((v) => (empty(v) ? null : v), required ? s : s.nullable()) as z.ZodType<AskAnswerValue>;
  }
  return z.object(shape).strict();
}

export const askMessagePayloadSchema = z.object({
  title: z.string().max(120).nullable(),
  // Exhibit tokens shown as chips under the message.
  links: z.array(z.string()).max(12).default([]),
});
export type AskMessagePayload = z.infer<typeof askMessagePayloadSchema>;

export const askQuestionPayloadSchema = z.object({
  title: z.string().min(1).max(120),
  fields: askFieldsSchema,
  submitLabel: z.string().max(40).nullable().default(null),
  answer: z.record(z.string(), z.unknown()).nullable().default(null),
});
export type AskQuestionPayload = z.infer<typeof askQuestionPayloadSchema>;

export const proposedActionSchema = z.object({
  // A Chamber name (or "congress") and one of its MCP tools.
  server: z.string().min(1).max(64),
  tool: z.string().min(1).max(128),
  args: z.record(z.string(), z.unknown()).default({}),
  // Plain-language description of this one change, shown to the owner.
  summary: z.string().min(1).max(300),
});
export type ProposedAction = z.infer<typeof proposedActionSchema>;

export const proposalResultSchema = z.object({ ok: z.boolean(), output: z.unknown().nullable(), error: z.string().nullable() });
export type ProposalResult = z.infer<typeof proposalResultSchema>;

export const askProposalPayloadSchema = z.object({
  title: z.string().min(1).max(120),
  actions: z.array(proposedActionSchema).min(1).max(10),
  results: z.array(proposalResultSchema).nullable().default(null),
  // The owner's note when rejecting.
  note: z.string().max(1000).nullable().default(null),
});
export type AskProposalPayload = z.infer<typeof askProposalPayloadSchema>;

export const answerAskRequestSchema = z.object({ values: z.record(z.string(), z.unknown()) });
export type AnswerAskRequest = z.infer<typeof answerAskRequestSchema>;

export const decideAskRequestSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(1000).optional() });
export type DecideAskRequest = z.infer<typeof decideAskRequestSchema>;

// Owner-facing list of what the AI is waiting on or has to say.
export const openAskSchema = z.object({
  messageId: z.number().int(),
  threadId: z.number().int(),
  threadTitle: z.string(),
  kind: z.enum(["message", "question", "proposal"]),
  title: z.string(),
  text: z.string(),
  payload: z.unknown(),
  createdAt: z.string(),
});
export type OpenAsk = z.infer<typeof openAskSchema>;
