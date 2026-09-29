import { z } from "zod";

// Runtime exhibit types: a definition is data (never code), rendered by
// Congress's generic record UI and backed by a real SQLite table.

export const SLUG_PATTERN = /^[a-z][a-z0-9_]{0,40}$/;
export const slugSchema = z.string().regex(SLUG_PATTERN, "lowercase letters, digits and _; starts with a letter");

export const FIELD_KINDS = ["text", "richtext", "boolean", "datetime", "number", "enum", "relation"] as const;
export const fieldKindSchema = z.enum(FIELD_KINDS);
export type FieldKind = z.infer<typeof fieldKindSchema>;

export const enumOptionSchema = z.object({ value: z.string().min(1).max(80), label: z.string().min(1).max(80) });
export type EnumOption = z.infer<typeof enumOptionSchema>;

export const fieldOptionsSchema = z
  .object({
    required: z.boolean().optional(),
    unique: z.boolean().optional(),
    searchable: z.boolean().optional(),
    // Gets its own index (sorting, feed rules, time triggers).
    indexed: z.boolean().optional(),
    integer: z.boolean().optional(),
    options: z.array(enumOptionSchema).max(100).optional(),
    target: slugSchema.optional(),
    many: z.boolean().optional(),
  })
  .strict();
export type FieldOptions = z.infer<typeof fieldOptionsSchema>;

export const fieldDefinitionSchema = z.object({
  id: z.string(),
  slug: slugSchema,
  label: z.string().min(1).max(80),
  kind: fieldKindSchema,
  // Physical column, fixed at creation; the join table for a to-many relation.
  column: z.string(),
  options: fieldOptionsSchema,
  retired: z.boolean(),
});
export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;

export const typeActionSchema = z.object({
  kind: z.literal("toggle"),
  field: z.string(),
  on: z.string().min(1).max(40),
  off: z.string().min(1).max(40),
});
export type TypeAction = z.infer<typeof typeActionSchema>;

export const feedRuleSchema = z.object({
  when: z.discriminatedUnion("op", [
    z.object({ op: z.literal("within_next"), field: z.string(), hours: z.number().positive().max(24 * 365) }),
    z.object({ op: z.literal("overdue"), field: z.string() }),
    z.object({ op: z.literal("eq"), field: z.string(), value: z.union([z.string(), z.number(), z.boolean()]) }),
    z.object({ op: z.literal("is_set"), field: z.string() }),
    z.object({ op: z.literal("updated_within"), hours: z.number().positive().max(24 * 365) }),
  ]),
  // Extra conditions that must also hold (e.g. done = false).
  and: z.array(z.object({ field: z.string(), value: z.union([z.string(), z.number(), z.boolean(), z.null()]) })).max(5).optional(),
  score: z.number().min(0).max(100),
  reason: z.string().max(60).optional(),
  preview: z.array(z.string()).max(4).optional(),
});
export type FeedRule = z.infer<typeof feedRuleSchema>;

export const typeDefinitionSchema = z.object({
  slug: slugSchema,
  label: z.string().min(1).max(60),
  pluralLabel: z.string().min(1).max(60),
  icon: z.string().max(40),
  tableName: z.string(),
  titleField: z.string().nullable(),
  fields: z.array(fieldDefinitionSchema),
  layout: z.object({ body: z.string().nullable() }),
  actions: z.array(typeActionSchema),
  feedRules: z.array(feedRuleSchema),
  eventPrefix: slugSchema,
  hidden: z.boolean(),
});
export type TypeDefinition = z.infer<typeof typeDefinitionSchema>;

// A field is referenced by its id, or by the slug of a non-retired field.
const fieldRef = z.string().min(1);

export const operationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create_type"),
    slug: slugSchema,
    label: z.string().min(1).max(60),
    pluralLabel: z.string().min(1).max(60).optional(),
    icon: z.string().max(40).optional(),
  }),
  z.object({
    op: z.literal("set_type_meta"),
    slug: slugSchema.optional(),
    label: z.string().min(1).max(60).optional(),
    pluralLabel: z.string().min(1).max(60).optional(),
    icon: z.string().max(40).optional(),
    eventPrefix: slugSchema.optional(),
    hidden: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("add_field"),
    slug: slugSchema,
    label: z.string().min(1).max(80),
    kind: fieldKindSchema,
    options: fieldOptionsSchema.optional(),
  }),
  z.object({ op: z.literal("rename_field"), field: fieldRef, slug: slugSchema.optional(), label: z.string().min(1).max(80).optional() }),
  z.object({ op: z.literal("retire_field"), field: fieldRef }),
  z.object({ op: z.literal("restore_field"), field: fieldRef }),
  z.object({ op: z.literal("change_field_kind"), field: fieldRef, kind: fieldKindSchema, options: fieldOptionsSchema.optional() }),
  z.object({ op: z.literal("set_field_options"), field: fieldRef, options: fieldOptionsSchema }),
  z.object({ op: z.literal("reorder_fields"), order: z.array(fieldRef) }),
  z.object({ op: z.literal("set_title_field"), field: fieldRef }),
  z.object({ op: z.literal("set_layout"), body: fieldRef.nullable() }),
  z.object({ op: z.literal("set_actions"), actions: z.array(typeActionSchema).max(5) }),
  z.object({ op: z.literal("set_feed_rules"), rules: z.array(feedRuleSchema).max(10) }),
]);
export type Operation = z.infer<typeof operationSchema>;

export const typeSummarySchema = z.object({
  id: z.string(),
  version: z.number().int(),
  origin: z.enum(["premade", "custom"]),
  definition: typeDefinitionSchema,
});
export type TypeSummary = z.infer<typeof typeSummarySchema>;

export type RecordValue = string | number | boolean | null | string[];

export const recordDtoSchema = z.object({
  id: z.string(),
  type: slugSchema,
  typeVersion: z.number().int(),
  values: z.record(z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())])),
  createdAt: z.string(),
  updatedAt: z.string(),
  provenance: z.object({ binding: z.string(), key: z.string() }).nullable(),
});
export type RecordDto = z.infer<typeof recordDtoSchema>;
