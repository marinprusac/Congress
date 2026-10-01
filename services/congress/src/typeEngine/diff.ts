import type {
  Binding,
  DefinitionChange,
  FactCondition,
  FeedRule,
  FieldDefinition,
  FieldOptions,
  TimeTrigger,
  TypeAction,
  TypeDefinition,
} from "@congress/shared-types";

// Pure: a definition change as short sentences for the owner to review.

type Area = DefinitionChange["area"];

const AUTO_CREATE_TEXT: Record<TypeDefinition["autoCreate"], string> = {
  never: "never (only you or the AI add them)",
  corresponded: "only people you've corresponded with",
  any: "anything a connected source sees",
};

export function diffDefinitions(before: TypeDefinition | null, after: TypeDefinition): DefinitionChange[] {
  const out: DefinitionChange[] = [];
  const add = (area: Area, text: string) => out.push({ area, text });
  const name = (def: TypeDefinition, id: string | null) => {
    const f = id ? def.fields.find((x) => x.id === id) : undefined;
    return f ? `“${f.label}”` : "none";
  };

  if (!before) {
    add("type", `Create type “${after.label}” (${after.pluralLabel})${after.hidden ? ", hidden" : ""}`);
  } else {
    if (before.slug !== after.slug) add("type", `Rename type slug ${before.slug} → ${after.slug}`);
    if (before.label !== after.label || before.pluralLabel !== after.pluralLabel) {
      add("type", `Rename type “${before.label}” (${before.pluralLabel}) → “${after.label}” (${after.pluralLabel})`);
    }
    if (before.icon !== after.icon) add("type", `Change icon to ${after.icon || "none"}`);
    if (before.eventPrefix !== after.eventPrefix) add("type", `Event prefix ${before.eventPrefix} → ${after.eventPrefix}`);
    if (before.hidden !== after.hidden) add("type", after.hidden ? "Hide type" : "Show type");
  }
  if ((before?.autoCreate ?? "never") !== after.autoCreate) add("type", `Auto-create: ${AUTO_CREATE_TEXT[after.autoCreate]}`);

  const prev = new Map((before?.fields ?? []).map((f) => [f.id, f]));
  for (const f of after.fields) {
    const p = prev.get(f.id);
    if (!p) {
      add("fields", `${f.retired ? "Add retired field" : "Add field"} “${f.label}” (${describeField(f)})`);
      continue;
    }
    if (p.slug !== f.slug || p.label !== f.label) add("fields", `Rename “${p.label}” (${p.slug}) → “${f.label}” (${f.slug})`);
    if (p.kind !== f.kind) add("fields", `Change “${f.label}” from ${p.kind} to ${f.kind}`);
    const opts = optionChanges(p.options, f.options);
    if (opts.length) add("fields", `“${f.label}”: ${opts.join(", ")}`);
    if (p.retired !== f.retired) add("fields", `${f.retired ? "Retire" : "Restore"} “${f.label}”`);
  }
  if (before) {
    // Order of the fields active on both sides.
    const both = new Set(after.fields.filter((f) => !f.retired && prev.get(f.id)?.retired === false).map((f) => f.id));
    const order = (def: TypeDefinition) => def.fields.filter((f) => both.has(f.id)).map((f) => f.id).join();
    if (order(before) !== order(after)) add("fields", "Reorder fields");
  }

  if ((before?.titleField ?? null) !== after.titleField) add("layout", `Title field: ${name(after, after.titleField)}`);
  if ((before?.layout.body ?? null) !== after.layout.body) add("layout", `Body field: ${name(after, after.layout.body)}`);
  if (JSON.stringify(before?.layout.timeRange ?? null) !== JSON.stringify(after.layout.timeRange ?? null)) {
    const r = after.layout.timeRange;
    add("layout", r ? `Time range: ${name(after, r.start)} to ${name(after, r.end)}${r.allDay ? `, all day by ${name(after, r.allDay)}` : ""}` : "No time range");
  }
  if (JSON.stringify(before?.layout.mapPoint ?? null) !== JSON.stringify(after.layout.mapPoint ?? null)) {
    const p = after.layout.mapPoint;
    add("layout", p ? `Map point: ${name(after, p.latitude)}, ${name(after, p.longitude)}${p.radius ? `, radius ${name(after, p.radius)}` : ""}` : "No map point");
  }

  const changed = <T>(a: T[] | undefined, b: T[]) => JSON.stringify(a ?? []) !== JSON.stringify(b);
  if (changed(before?.actions, after.actions)) {
    if (!after.actions.length) add("actions", "Remove all actions");
    for (const a of after.actions) add("actions", `Action: ${describeAction(after, a)}`);
  }
  if (changed(before?.feedRules, after.feedRules)) {
    if (!after.feedRules.length) add("feed", "Remove all feed rules");
    for (const r of after.feedRules) add("feed", `Feed rule: ${describeRule(after, r)}`);
  }
  if (changed(before?.timeTriggers, after.timeTriggers)) {
    if (!after.timeTriggers.length) add("triggers", "Remove all time triggers");
    for (const t of after.timeTriggers) add("triggers", `Time trigger: ${describeTrigger(after, t)}`);
  }
  const prevBindings = new Map((before?.bindings ?? []).map((b) => [b.id, b]));
  for (const b of after.bindings) {
    const p = prevBindings.get(b.id);
    prevBindings.delete(b.id);
    if (p && JSON.stringify(p) === JSON.stringify(b)) continue;
    add("bindings", `${p ? "Change" : "Add"} binding to ${b.label} (${b.connector} ${b.kind}): ${describeBinding(after, b)}`);
  }
  for (const b of prevBindings.values()) add("bindings", `Remove binding to ${b.label}; its records stay, no longer synced`);
  return out;
}

function describeBinding(def: TypeDefinition, b: Binding): string {
  const group = (mode: "sync" | "pull") =>
    b.fields.filter((m) => m.mode === mode).map((m) => (m.source === fieldLabel(def, m.target) ? m.source : `${m.source} → ${fieldLabel(def, m.target)}`));
  const synced = group("sync");
  const pulled = group("pull");
  const parts = [
    synced.length ? `syncs ${synced.join(", ")}` : "",
    pulled.length ? `reads ${pulled.join(", ")}` : "",
    b.lock ? `read-only unless ${describeFact(b.lock)}` : "",
    b.create ? `new records go to the source (by ${fieldLabel(def, b.create.targetField)})` : "",
    b.delete === "push" ? "deletes reach the source" : "can't be deleted here",
    b.actions.length ? `actions ${b.actions.map((a) => a.label).join(", ")}` : "",
  ];
  return parts.filter(Boolean).join("; ");
}

function describeFact(c: FactCondition): string {
  return c.equals === undefined ? c.fact : `${c.fact} = ${JSON.stringify(c.equals)}`;
}

function describeField(f: FieldDefinition): string {
  const bits: string[] = [f.kind];
  const o = f.options;
  if (o.target) bits[0] = `${o.many ? "links" : "link"} to ${o.target}`;
  if (o.key) bits.push(`${o.key} key`);
  if (o.options) bits.push(o.options.map((x) => x.label).join("/"));
  for (const key of ["required", "unique", "searchable", "indexed", "integer", "readonly", "hidden"] as const) if (o[key]) bits.push(key);
  return bits.join(", ");
}

function optionChanges(a: FieldOptions, b: FieldOptions): string[] {
  const out: string[] = [];
  for (const key of ["required", "unique", "searchable", "indexed", "integer", "readonly", "hidden", "many"] as const) {
    if (Boolean(a[key]) !== Boolean(b[key])) out.push(`${key} ${b[key] ? "on" : "off"}`);
  }
  if (a.target !== b.target) out.push(`target ${b.target ?? "none"}`);
  if (a.key !== b.key) out.push(b.key ? `${b.key} key` : "no longer a key");
  const before = new Map((a.options ?? []).map((o) => [o.value, o.label]));
  const after = new Map((b.options ?? []).map((o) => [o.value, o.label]));
  for (const [v, label] of after) {
    if (!before.has(v)) out.push(`+option ${label}`);
    else if (before.get(v) !== label) out.push(`option ${before.get(v)} → ${label}`);
  }
  for (const [v, label] of before) if (!after.has(v)) out.push(`−option ${label}`);
  return out;
}

const fieldLabel = (def: TypeDefinition, ref: string) => {
  const f = def.fields.find((x) => x.id === ref) ?? def.fields.find((x) => x.slug === ref);
  return f ? f.slug : ref;
};

function describeConditions(def: TypeDefinition, and: { field: string; value: unknown }[] | undefined): string {
  return (and ?? []).map((c) => ` and ${fieldLabel(def, c.field)} = ${JSON.stringify(c.value)}`).join("");
}

function describeAction(def: TypeDefinition, a: TypeAction): string {
  const events = [a.onEvent && `on → ${a.onEvent}`, a.offEvent && `off → ${a.offEvent}`].filter(Boolean).join(", ");
  const stamp = a.stampField ? `, stamps ${fieldLabel(def, a.stampField)}` : "";
  return `${a.off}/${a.on} toggles ${fieldLabel(def, a.field)}${events ? ` (${events})` : ""}${stamp}`;
}

function describeRule(def: TypeDefinition, r: FeedRule): string {
  const w = r.when;
  const when =
    w.op === "within_next"
      ? `${fieldLabel(def, w.field)} within ${w.hours}h`
      : w.op === "overdue"
        ? `${fieldLabel(def, w.field)} overdue`
        : w.op === "within_last"
          ? `${fieldLabel(def, w.field)} within the last ${w.hours}h`
        : w.op === "ongoing"
          ? `under way (${fieldLabel(def, w.field)} to ${fieldLabel(def, w.end)})`
          : w.op === "eq"
          ? `${fieldLabel(def, w.field)} = ${JSON.stringify(w.value)}`
          : w.op === "is_set"
            ? `${fieldLabel(def, w.field)} is set`
            : `updated within ${w.hours}h`;
  return `${when}${describeConditions(def, r.and)} → score ${r.score}${r.reason ? ` “${r.reason}”` : ""}`;
}

function formatOffset(minutes: number): string {
  if (minutes === 0) return "at the time";
  const abs = Math.abs(minutes);
  const unit = abs % 1440 === 0 ? `${abs / 1440}d` : abs % 60 === 0 ? `${abs / 60}h` : `${abs}m`;
  return `${unit} ${minutes < 0 ? "before" : "after"}`;
}

function describeTrigger(def: TypeDefinition, t: TimeTrigger): string {
  const steps = t.steps.map((s) => `${s.event} ${formatOffset(s.offsetMinutes)}`).join(", ");
  const anchor = t.anchor ? ` (${t.anchor.replace(/_/g, " ")})` : "";
  const clear = t.clearEvent ? `; clears with ${t.clearEvent.event}` : "";
  return `${fieldLabel(def, t.field)}${anchor}${describeConditions(def, t.and)}: ${steps}${clear}`;
}
