import { z } from "zod";

// Runtime exhibit types: a definition is data (never code), rendered by
// Congress's generic record UI and backed by a real SQLite table.

export const SLUG_PATTERN = /^[a-z][a-z0-9_]{0,40}$/;
export const slugSchema = z.string().regex(SLUG_PATTERN, "lowercase letters, digits and _; starts with a letter");

export const FIELD_KINDS = ["text", "richtext", "boolean", "datetime", "date", "number", "enum", "relation", "file"] as const;
export const fieldKindSchema = z.enum(FIELD_KINDS);
export type FieldKind = z.infer<typeof fieldKindSchema>;

export const KEY_KINDS = ["email", "phone"] as const;
export type KeyKind = (typeof KEY_KINDS)[number];

// Who may make a record appear on its own (lookupOrCreate): nobody, only
// people the owner corresponded with, or anything a source sees.
export const AUTO_CREATE = ["never", "corresponded", "any"] as const;
export type AutoCreate = (typeof AUTO_CREATE)[number];

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
    // Written only by the engine (e.g. a toggle's stamp), never by input.
    readonly: z.boolean().optional(),
    // Kept and readable by the AI, but not shown on the record screen.
    hidden: z.boolean().optional(),
    // Text only: one value per line, each a lookup key (lookupOrCreate).
    key: z.enum(KEY_KINDS).nullable().optional(),
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
  // Events (<prefix>.<name>) when the boolean turns on/off, by any write.
  onEvent: slugSchema.optional(),
  offEvent: slugSchema.optional(),
  // A datetime field set to now when the boolean turns on, cleared when off.
  stampField: z.string().optional(),
});
export type TypeAction = z.infer<typeof typeActionSchema>;

export const feedRuleSchema = z.object({
  when: z.discriminatedUnion("op", [
    z.object({ op: z.literal("within_next"), field: z.string(), hours: z.number().positive().max(24 * 365) }),
    z.object({ op: z.literal("overdue"), field: z.string() }),
    z.object({ op: z.literal("eq"), field: z.string(), value: z.union([z.string(), z.number(), z.boolean()]) }),
    z.object({ op: z.literal("is_set"), field: z.string() }),
    z.object({ op: z.literal("updated_within"), hours: z.number().positive().max(24 * 365) }),
    // Under way now: field (start) <= now < end.
    z.object({ op: z.literal("ongoing"), field: z.string(), end: z.string() }),
    // Happened within the last hours (field in the past, newer scores higher).
    z.object({ op: z.literal("within_last"), field: z.string(), hours: z.number().positive().max(24 * 365) }),
  ]),
  // Extra conditions that must also hold (e.g. done = false).
  and: z.array(z.object({ field: z.string(), value: z.union([z.string(), z.number(), z.boolean(), z.null()]) })).max(5).optional(),
  score: z.number().min(0).max(100),
  reason: z.string().max(60).optional(),
  preview: z.array(z.string()).max(4).optional(),
});
export type FeedRule = z.infer<typeof feedRuleSchema>;

// A ladder of events relative to a date/datetime field: a record's state is
// the latest step it has reached; falling back out of every step fires clearEvent.
export const triggerEventSchema = z.object({ event: slugSchema, label: z.string().min(1).max(80) });
export const timeTriggerSchema = z.object({
  field: z.string(),
  // Date fields only: offsets count from the day's start, or its end (default).
  anchor: z.enum(["start_of_day", "end_of_day"]).optional(),
  and: z.array(z.object({ field: z.string(), value: z.union([z.string(), z.number(), z.boolean(), z.null()]) })).max(5).optional(),
  steps: z.array(triggerEventSchema.extend({ offsetMinutes: z.number().int().min(-525_600).max(525_600) })).min(1).max(5),
  clearEvent: triggerEventSchema.optional(),
});
export type TimeTrigger = z.infer<typeof timeTriggerSchema>;

// A binding wires a connector's source records into this type. `sync` fields
// are pulled and pushed back; `pull` fields are only pulled (read-only when bound).
const connectorName = z.string().regex(/^[a-z][a-z0-9-]{0,40}$/);
const sourceSlug = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,40}$/);
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
// A per-record fact holds (truthy, or equal to `equals`).
export const factConditionSchema = z.object({ fact: sourceSlug, equals: scalar.optional() });
export type FactCondition = z.infer<typeof factConditionSchema>;
export const bindingFieldSchema = z.object({ source: sourceSlug, target: z.string(), mode: z.enum(["sync", "pull"]) });
export const bindingActionSchema = z.object({
  id: slugSchema,
  label: z.string().min(1).max(40),
  // The connector's push.act action and its arguments.
  act: z.string().min(1).max(40),
  args: z.record(scalar).default({}),
  when: z.array(factConditionSchema).max(3).default([]),
  unless: z.array(factConditionSchema).max(3).default([]),
});
export type BindingAction = z.infer<typeof bindingActionSchema>;
export const bindingSchema = z.object({
  id: z.string(),
  connector: connectorName,
  kind: sourceSlug,
  label: z.string().min(1).max(60),
  fields: z.array(bindingFieldSchema).min(1).max(40),
  // Sync fields turn read-only on records where this fact doesn't hold.
  lock: factConditionSchema.optional(),
  // New records push to the source; this sync field's value picks where ("" = stay local).
  create: z.object({ targetField: z.string() }).optional(),
  delete: z.enum(["push", "never"]),
  actions: z.array(bindingActionSchema).max(8).default([]),
});
export type Binding = z.infer<typeof bindingSchema>;
export type BindingInput = Omit<z.input<typeof bindingSchema>, "id">;

export const typeDefinitionSchema = z.object({
  slug: slugSchema,
  label: z.string().min(1).max(60),
  pluralLabel: z.string().min(1).max(60),
  icon: z.string().max(40),
  tableName: z.string(),
  titleField: z.string().nullable(),
  fields: z.array(fieldDefinitionSchema),
  // timeRange pairs start/end (and an all-day boolean) into one control and feed time.
  layout: z.object({
    body: z.string().nullable(),
    timeRange: z.object({ start: z.string(), end: z.string(), allDay: z.string().nullable() }).nullable().optional(),
    // mapPoint pairs latitude/longitude (and a radius in metres) number fields into one map picker.
    mapPoint: z.object({ latitude: z.string(), longitude: z.string(), radius: z.string().nullable() }).nullable().optional(),
  }),
  actions: z.array(typeActionSchema),
  feedRules: z.array(feedRuleSchema),
  timeTriggers: z.array(timeTriggerSchema).default([]),
  eventPrefix: slugSchema,
  hidden: z.boolean(),
  autoCreate: z.enum(AUTO_CREATE).default("never"),
  bindings: z.array(bindingSchema).default([]),
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
    autoCreate: z.enum(AUTO_CREATE).optional(),
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
  z.object({ op: z.literal("set_time_range"), range: z.object({ start: fieldRef, end: fieldRef, allDay: fieldRef.nullable().optional() }).nullable() }),
  z.object({ op: z.literal("set_map_point"), point: z.object({ latitude: fieldRef, longitude: fieldRef, radius: fieldRef.nullable().optional() }).nullable() }),
  z.object({ op: z.literal("set_actions"), actions: z.array(typeActionSchema).max(5) }),
  z.object({ op: z.literal("set_feed_rules"), rules: z.array(feedRuleSchema).max(10) }),
  z.object({ op: z.literal("set_time_triggers"), triggers: z.array(timeTriggerSchema).max(3) }),
  // Adds or replaces the binding for this connector + source kind.
  z.object({ op: z.literal("set_binding"), binding: bindingSchema.omit({ id: true }) }),
  z.object({ op: z.literal("remove_binding"), connector: connectorName, kind: sourceSlug }),
]);
export type Operation = z.infer<typeof operationSchema>;

export const typeSummarySchema = z.object({
  id: z.string(),
  version: z.number().int(),
  origin: z.enum(["premade", "custom"]),
  definition: typeDefinitionSchema,
});
export type TypeSummary = z.infer<typeof typeSummarySchema>;

// A `file` field's value as read; writes take the file's id instead.
export const fileRefSchema = z.object({ id: z.string(), name: z.string(), mime: z.string(), size: z.number().int() });
export type FileRef = z.infer<typeof fileRefSchema>;

export type RecordValue = string | number | boolean | null | string[] | FileRef;

export const recordDtoSchema = z.object({
  id: z.string(),
  type: slugSchema,
  typeVersion: z.number().int(),
  values: z.record(z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string()), fileRefSchema])),
  createdAt: z.string(),
  updatedAt: z.string(),
  provenance: z.object({ binding: z.string(), key: z.string() }).nullable(),
  // Single-record reads of a bound record: what the binding allows right now.
  binding: z
    .object({
      id: z.string(),
      connector: z.string(),
      label: z.string(),
      // Field slugs the owner can't edit on this record.
      locked: z.array(z.string()),
      lockReason: z.string().nullable(),
      actions: z.array(z.object({ id: z.string(), label: z.string() })),
      // Source values no field holds (hybrid storage), read live.
      live: z.record(z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())])),
      // The connector serves live content (GET /congress/records/:id/live).
      detail: z.boolean().optional(),
      pending: z.object({ error: z.string().nullable(), failed: z.boolean(), since: z.string() }).nullable(),
    })
    .nullable()
    .optional(),
});
export type RecordDto = z.infer<typeof recordDtoSchema>;

// One human-readable line of a definition diff (Settings → Types, publish asks).
export const definitionChangeSchema = z.object({
  area: z.enum(["type", "fields", "layout", "actions", "feed", "triggers", "bindings"]),
  text: z.string(),
});
export type DefinitionChange = z.infer<typeof definitionChangeSchema>;

export const typeVersionSchema = z.object({
  version: z.number().int(),
  actor: z.string(),
  createdAt: z.string(),
  changes: z.array(definitionChangeSchema),
});
export type TypeVersion = z.infer<typeof typeVersionSchema>;

// Settings → Types list entry.
export const typeOverviewSchema = typeSummarySchema.extend({
  forked: z.boolean(),
  recordCount: z.number().int(),
});
export type TypeOverview = z.infer<typeof typeOverviewSchema>;

// Reverse relations: the records whose relation field links to one record.
export const relatedGroupSchema = z.object({
  type: z.string(),
  typeLabel: z.string(),
  field: z.string(),
  fieldLabel: z.string(),
  total: z.number().int(),
  records: z.array(z.object({ id: z.string(), name: z.string(), url: z.string() })),
});
export type RelatedGroup = z.infer<typeof relatedGroupSchema>;
