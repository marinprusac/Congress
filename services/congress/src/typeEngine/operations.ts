import type { FieldDefinition, FieldKind, FieldOptions, Operation, TypeDefinition } from "@congress/shared-types";

// Pure: applies builder operations to a definition. Field ids and columns are
// fixed at creation, so renames never touch SQL (see planner.ts).

export const SYSTEM_COLUMNS = ["id", "created_at", "updated_at", "source_binding", "source_key"] as const;
const RESERVED_FIELD_SLUGS = new Set<string>([...SYSTEM_COLUMNS, "type", "rowid", "oid", "_rowid_"]);
const RESERVED_TYPE_SLUGS = new Set(["e", "record", "records", "type", "types", "new"]);

export class OperationError extends Error {}

export interface ApplyResult {
  def: TypeDefinition;
  errors: string[];
}

export interface ApplyContext {
  // Table names already used by other types (x_* and j_*), kept unique DB-wide.
  takenTables?: ReadonlySet<string>;
}

export function applyOperations(start: TypeDefinition | null, ops: Operation[], ctx: ApplyContext = {}): ApplyResult {
  const errors: string[] = [];
  const taken = ctx.takenTables ?? new Set<string>();
  let def = start ? structuredClone(start) : null;
  ops.forEach((op, i) => {
    try {
      def = applyOne(def, op, taken);
    } catch (err) {
      if (!(err instanceof OperationError)) throw err;
      errors.push(`#${i + 1} ${op.op}: ${err.message}`);
    }
  });
  if (!def) throw new OperationError(errors.join("; ") || "the first operation must be create_type");
  if (errors.length === 0) errors.push(...validateDefinition(def));
  return { def, errors };
}

function applyOne(def: TypeDefinition | null, op: Operation, taken: ReadonlySet<string>): TypeDefinition {
  if (op.op === "create_type") {
    if (def) throw new OperationError("type already exists");
    if (RESERVED_TYPE_SLUGS.has(op.slug)) throw new OperationError(`"${op.slug}" is reserved`);
    return {
      slug: op.slug,
      label: op.label,
      pluralLabel: op.pluralLabel ?? `${op.label}s`,
      icon: op.icon ?? "file",
      tableName: uniqueName(`x_${op.slug}`, taken),
      titleField: null,
      fields: [],
      layout: { body: null },
      actions: [],
      feedRules: [],
      timeTriggers: [],
      eventPrefix: op.slug,
      hidden: false,
    };
  }
  if (!def) throw new OperationError("the first operation must be create_type");
  const d = def;

  switch (op.op) {
    case "set_type_meta": {
      if (op.slug !== undefined) {
        if (RESERVED_TYPE_SLUGS.has(op.slug)) throw new OperationError(`"${op.slug}" is reserved`);
        d.slug = op.slug;
      }
      if (op.label !== undefined) d.label = op.label;
      if (op.pluralLabel !== undefined) d.pluralLabel = op.pluralLabel;
      if (op.icon !== undefined) d.icon = op.icon;
      if (op.eventPrefix !== undefined) d.eventPrefix = op.eventPrefix;
      if (op.hidden !== undefined) d.hidden = op.hidden;
      return d;
    }
    case "add_field": {
      assertSlugFree(d, op.slug);
      const options = normalizeOptions(op.kind, op.options ?? {});
      const id = uniqueName(`fld_${op.slug}`, new Set(d.fields.map((f) => f.id)));
      const column =
        op.kind === "relation" && options.many
          ? uniqueName(`j_${d.tableName.slice(2)}_${op.slug}`, new Set([...taken, ...d.fields.map((f) => f.column)]))
          : uniqueName(op.slug, new Set([...SYSTEM_COLUMNS, ...d.fields.map((f) => f.column)]));
      d.fields.push({ id, slug: op.slug, label: op.label, kind: op.kind, column, options, retired: false });
      return d;
    }
    case "rename_field": {
      const f = findField(d, op.field);
      if (op.slug !== undefined && op.slug !== f.slug) {
        assertSlugFree(d, op.slug);
        f.slug = op.slug;
      }
      if (op.label !== undefined) f.label = op.label;
      return d;
    }
    case "retire_field": {
      const f = findField(d, op.field);
      if (d.titleField === f.id) throw new OperationError("can't retire the title field");
      f.retired = true;
      if (d.layout.body === f.id) d.layout.body = null;
      d.actions = d.actions
        .filter((a) => a.field !== f.id)
        .map((a) => (a.stampField === f.id ? { ...a, stampField: undefined } : a));
      d.timeTriggers = d.timeTriggers.filter((t) => t.field !== f.id && !t.and?.some((c) => c.field === f.id));
      return d;
    }
    case "restore_field": {
      const f = findField(d, op.field, true);
      if (!f.retired) throw new OperationError(`field "${f.slug}" isn't retired`);
      assertSlugFree(d, f.slug);
      f.retired = false;
      return d;
    }
    case "change_field_kind": {
      const f = findField(d, op.field);
      for (const k of ["relation", "file"] as const) {
        if ((f.kind === k || op.kind === k) && f.kind !== op.kind) throw new OperationError(`changing to or from a ${k} isn't supported`);
      }
      f.kind = op.kind;
      f.options = normalizeOptions(op.kind, { ...keepCompatible(f.options, op.kind), ...op.options });
      return d;
    }
    case "set_field_options": {
      const f = findField(d, op.field);
      const merged = { ...f.options, ...op.options };
      if (f.kind === "relation" && Boolean(merged.many) !== Boolean(f.options.many)) {
        throw new OperationError("a relation can't switch between one and many");
      }
      if (f.kind === "relation" && f.options.target && merged.target !== f.options.target) {
        throw new OperationError("a relation's target type can't change; add a new field instead");
      }
      f.options = normalizeOptions(f.kind, merged);
      return d;
    }
    case "reorder_fields": {
      const ordered = op.order.map((ref) => findField(d, ref, true));
      const seen = new Set(ordered.map((f) => f.id));
      if (seen.size !== ordered.length) throw new OperationError("duplicate field in order");
      d.fields = [...ordered, ...d.fields.filter((f) => !seen.has(f.id))];
      return d;
    }
    case "set_title_field": {
      const f = findField(d, op.field);
      if (f.kind !== "text") throw new OperationError("the title field must be text");
      d.titleField = f.id;
      return d;
    }
    case "set_layout": {
      if (op.body === null) {
        d.layout.body = null;
        return d;
      }
      const f = findField(d, op.body);
      if (f.kind !== "richtext") throw new OperationError("the body field must be richtext");
      d.layout.body = f.id;
      return d;
    }
    case "set_actions": {
      d.actions = op.actions.map((a) => {
        const f = findField(d, a.field);
        if (f.kind !== "boolean") throw new OperationError(`action field "${f.slug}" must be boolean`);
        const stamp = a.stampField ? findField(d, a.stampField) : undefined;
        if (stamp && stamp.kind !== "datetime") throw new OperationError(`stamp field "${stamp.slug}" must be datetime`);
        return { ...a, field: f.id, ...(stamp ? { stampField: stamp.id } : {}) };
      });
      return d;
    }
    case "set_time_triggers": {
      d.timeTriggers = op.triggers.map((t) => ({
        ...t,
        field: findField(d, t.field).id,
        and: t.and?.map((c) => ({ ...c, field: findField(d, c.field).id })),
      }));
      return d;
    }
    case "set_feed_rules": {
      d.feedRules = op.rules.map((rule) => {
        const when = "field" in rule.when ? { ...rule.when, field: findField(d, rule.when.field).id } : rule.when;
        return {
          ...rule,
          when,
          and: rule.and?.map((c) => ({ ...c, field: findField(d, c.field).id })),
          preview: rule.preview?.map((ref) => findField(d, ref).id),
        } as TypeDefinition["feedRules"][number];
      });
      return d;
    }
  }
}

// Whole-definition checks that individual ops can't see on their own.
export function validateDefinition(def: TypeDefinition): string[] {
  const errors: string[] = [];
  const active = def.fields.filter((f) => !f.retired);
  if (!def.titleField) errors.push("a title field is required");
  for (const f of active) {
    if (f.kind === "enum" && !(f.options.options?.length)) errors.push(`enum "${f.slug}" needs options`);
    if (f.kind === "relation" && !f.options.target) errors.push(`relation "${f.slug}" needs a target type`);
    if (f.options.readonly && f.options.required) errors.push(`"${f.slug}" can't be both readonly and required`);
  }
  const isTime = (f: FieldDefinition) => f.kind === "datetime" || f.kind === "date";
  for (const { when } of def.feedRules) {
    if (when.op !== "within_next" && when.op !== "overdue") continue;
    const f = def.fields.find((x) => x.id === when.field);
    if (f && !isTime(f)) errors.push(`feed rule ${when.op} needs a date or datetime field, "${f.slug}" is ${f.kind}`);
  }
  const ladderFields = new Set<string>();
  for (const t of def.timeTriggers) {
    const f = def.fields.find((x) => x.id === t.field);
    if (f && !isTime(f)) errors.push(`time trigger needs a date or datetime field, "${f.slug}" is ${f.kind}`);
    if (ladderFields.has(t.field)) errors.push(`only one time trigger per field ("${f?.slug}")`);
    ladderFields.add(t.field);
  }
  const events = [
    ...def.actions.flatMap((a) => [a.onEvent, a.offEvent]),
    ...def.timeTriggers.flatMap((t) => [...t.steps.map((s) => s.event), t.clearEvent?.event]),
  ].filter((e): e is string => Boolean(e));
  const seen = new Set<string>(["created", "updated", "deleted"]);
  for (const e of events) {
    if (seen.has(e)) errors.push(`event "${e}" is used twice`);
    seen.add(e);
  }
  return errors;
}

export function findField(def: TypeDefinition, ref: string, includeRetired = false): FieldDefinition {
  const byId = def.fields.find((f) => f.id === ref);
  if (byId && (includeRetired || !byId.retired)) return byId;
  const bySlug = def.fields.find((f) => f.slug === ref && !f.retired);
  if (bySlug) return bySlug;
  if (includeRetired) {
    const retired = def.fields.find((f) => f.slug === ref);
    if (retired) return retired;
  }
  throw new OperationError(`no field "${ref}"`);
}

export function activeFields(def: TypeDefinition): FieldDefinition[] {
  return def.fields.filter((f) => !f.retired);
}

function assertSlugFree(def: TypeDefinition, slug: string) {
  if (RESERVED_FIELD_SLUGS.has(slug)) throw new OperationError(`"${slug}" is reserved`);
  if (def.fields.some((f) => !f.retired && f.slug === slug)) throw new OperationError(`field "${slug}" already exists`);
}

function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
}

// Drops options that don't apply to a kind, so definitions stay tidy.
function normalizeOptions(kind: FieldKind, options: FieldOptions): FieldOptions {
  const out: FieldOptions = {};
  if (options.required) out.required = true;
  if (options.indexed) out.indexed = true;
  if (options.readonly) out.readonly = true;
  if (options.unique && kind !== "boolean" && kind !== "richtext" && kind !== "file" && !(kind === "relation" && options.many)) out.unique = true;
  if (options.searchable && (kind === "text" || kind === "richtext")) out.searchable = true;
  if (kind === "number" && options.integer) out.integer = true;
  if (kind === "enum") out.options = dedupeOptions(options.options ?? []);
  if (kind === "relation") {
    if (options.target) out.target = options.target;
    if (options.many) out.many = true;
  }
  return out;
}

function keepCompatible(options: FieldOptions, kind: FieldKind): FieldOptions {
  return normalizeOptions(kind, options);
}

function dedupeOptions(options: NonNullable<FieldOptions["options"]>) {
  const seen = new Set<string>();
  const out = [];
  for (const o of options) {
    if (seen.has(o.value)) throw new OperationError(`duplicate enum value "${o.value}"`);
    seen.add(o.value);
    out.push(o);
  }
  return out;
}

// Pure: the definition a rollback publishes. Fields added after `target` keep
// their columns but come back retired, so nothing is lost and no name clashes.
export function rollbackDefinition(current: TypeDefinition, target: TypeDefinition): TypeDefinition {
  const known = new Set(target.fields.map((f) => f.id));
  const newer = current.fields.filter((f) => !known.has(f.id)).map((f) => ({ ...f, retired: true }));
  return { ...structuredClone(target), tableName: current.tableName, fields: [...structuredClone(target.fields), ...newer] };
}
