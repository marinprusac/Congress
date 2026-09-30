import { describe, expect, it } from "vitest";
import type { Operation, TypeDefinition } from "@congress/shared-types";
import { applyOperations } from "../operations.js";
import { diffDefinitions } from "../diff.js";
import { planMigration } from "../planner.js";
import type { SourceKind } from "../../connectors/contract.js";
import { availableActions, bindingProblems, computeLocks, projectRich, toSourceValue, toTargetValue } from "./mapping.js";

const base: Operation[] = [
  { op: "create_type", slug: "event", label: "Event" },
  { op: "add_field", slug: "title", label: "Title", kind: "text" },
  { op: "set_title_field", field: "title" },
  { op: "add_field", slug: "notes", label: "Notes", kind: "richtext" },
  { op: "add_field", slug: "start", label: "Start", kind: "datetime" },
  { op: "add_field", slug: "calendar", label: "Calendar", kind: "text" },
  { op: "add_field", slug: "response", label: "Response", kind: "enum", options: { options: [{ value: "accepted", label: "Yes" }, { value: "declined", label: "No" }] } },
  { op: "add_field", slug: "hidden", label: "Hidden", kind: "boolean" },
];

const binding: Extract<Operation, { op: "set_binding" }> = {
  op: "set_binding",
  binding: {
    connector: "fake-cal",
    kind: "event",
    label: "Fake Calendar",
    fields: [
      { source: "title", target: "title", mode: "sync" },
      { source: "notes", target: "notes", mode: "sync" },
      { source: "start", target: "start", mode: "sync" },
      { source: "calendar", target: "calendar", mode: "sync" },
      { source: "response", target: "response", mode: "pull" },
    ],
    lock: { fact: "editable" },
    create: { targetField: "calendar" },
    delete: "push",
    actions: [{ id: "decline", label: "Decline", act: "rsvp", args: { response: "declined" }, when: [{ fact: "canRsvp" }], unless: [{ fact: "response", equals: "declined" }] }],
  },
};

const source: SourceKind = {
  kind: "event",
  label: "Event",
  fields: [
    { slug: "title", kind: "text", label: "Title" },
    { slug: "notes", kind: "text", label: "Notes" },
    { slug: "start", kind: "datetime", label: "Start" },
    { slug: "calendar", kind: "text", label: "Calendar" },
    { slug: "response", kind: "text", label: "Response" },
  ],
  facts: [
    { slug: "editable", label: "Editable" },
    { slug: "canRsvp", label: "Can answer" },
    { slug: "response", label: "Response" },
  ],
};

function build(ops: Operation[] = [binding]): TypeDefinition {
  const { def, errors } = applyOperations(null, [...base, ...ops]);
  expect(errors).toEqual([]);
  return def;
}

describe("binding operations", () => {
  it("adds a binding by connector + kind, with field ids", () => {
    const def = build();
    expect(def.bindings).toHaveLength(1);
    const b = def.bindings[0]!;
    expect(b.id).toBe("bnd_fake-cal_event");
    expect(b.fields.map((m) => m.target)).toEqual(["fld_title", "fld_notes", "fld_start", "fld_calendar", "fld_response"]);
    expect(b.create).toEqual({ targetField: "fld_calendar" });
    // Setting it again replaces it.
    const again = applyOperations(def, [{ ...binding, binding: { ...binding.binding, label: "Renamed" } }]).def;
    expect(again.bindings.map((x) => x.label)).toEqual(["Renamed"]);
  });

  it("refuses bad mappings", () => {
    const bad = (b: Partial<typeof binding.binding>) => applyOperations(null, [...base, { op: "set_binding", binding: { ...binding.binding, ...b } }]).errors;
    expect(bad({ fields: [{ source: "x", target: "nope", mode: "sync" }] })[0]).toMatch(/no field "nope"/);
    expect(bad({ fields: [{ source: "a", target: "title", mode: "sync" }, { source: "b", target: "title", mode: "pull" }] })[0]).toMatch(/bound twice/);
    expect(bad({ create: { targetField: "hidden" } })[0]).toMatch(/must be a synced field/);
    expect(applyOperations(build(), [{ op: "remove_binding", connector: "other", kind: "event" }]).errors[0]).toMatch(/no binding/);
  });

  it("retiring a field drops its mapping and the create target", () => {
    const { def } = applyOperations(build(), [{ op: "retire_field", field: "calendar" }]);
    expect(def.bindings[0]!.fields.map((m) => m.source)).not.toContain("calendar");
    expect(def.bindings[0]!.create).toBeUndefined();
  });

  it("describes and plans a removal", () => {
    const before = build();
    const after = applyOperations(before, [{ op: "remove_binding", connector: "fake-cal", kind: "event" }]).def;
    expect(diffDefinitions(before, after)).toEqual([{ area: "bindings", text: "Remove binding to Fake Calendar; its records stay, no longer synced" }]);
    const plan = planMigration(before, after);
    expect(plan.steps.some((s) => s.startsWith(`UPDATE "x_event" SET "source_binding" = NULL`))).toBe(true);
    expect(plan.preflight[0]!.label).toMatch(/stop syncing/);
    const added = diffDefinitions(applyOperations(null, base).def, before).find((c) => c.area === "bindings")!.text;
    expect(added).toMatch(/^Add binding to Fake Calendar \(fake-cal event\): syncs title, notes, start, calendar; reads response; read-only unless editable/);
  });
});

describe("binding against a source schema", () => {
  it("accepts a fitting binding and names what doesn't fit", () => {
    const def = build();
    expect(bindingProblems(def, def.bindings[0]!, source, true)).toEqual([]);
    expect(bindingProblems(def, def.bindings[0]!, undefined, true)[0]).toMatch(/no source kind/);
    expect(bindingProblems(def, def.bindings[0]!, source, false)[0]).toMatch(/can't write back/);
    const wrong = { ...source, fields: source.fields.map((f) => (f.slug === "start" ? { ...f, kind: "boolean" as const } : f)), facts: [] };
    const problems = bindingProblems(def, def.bindings[0]!, wrong, true);
    expect(problems).toContain(`"start" → "start": boolean can't fill a datetime field`);
    expect(problems).toContain("fake-cal event has no fact \"editable\"");
  });
});

describe("mapping values", () => {
  const def = build();
  const f = (slug: string) => def.fields.find((x) => x.slug === slug)!;

  it("converts source values into field values and back", () => {
    expect(toTargetValue("2026-10-01T09:00:00+02:00", f("start"))).toBe("2026-10-01T07:00:00.000Z");
    expect(toTargetValue(null, f("title"))).toBe("");
    expect(toTargetValue("maybe", f("response"))).toBeNull();
    expect(toTargetValue("declined", f("response"))).toBe("declined");
    expect(toSourceValue("[[exhibit:e:01abc|Ana]] and [[exhibit:e:01def]]", f("notes"))).toBe("Ana and 01def");
    expect(projectRich("plain")).toBe("plain");
  });

  it("locks pulled fields always, synced ones when the fact fails or the source is gone", () => {
    const b = def.bindings[0]!;
    expect(computeLocks(def, b, { editable: true })).toEqual({ locked: ["response"], reason: null });
    expect(computeLocks(def, b, { editable: false })).toEqual({
      locked: ["response", "title", "notes", "start", "calendar"],
      reason: "Read-only in Fake Calendar",
    });
    expect(computeLocks(def, b, null).reason).toMatch(/No longer in Fake Calendar/);
  });

  it("offers actions whose facts hold", () => {
    const b = def.bindings[0]!;
    expect(availableActions(b, { canRsvp: true }).map((a) => a.id)).toEqual(["decline"]);
    expect(availableActions(b, { canRsvp: true, response: "declined" })).toEqual([]);
    expect(availableActions(b, { canRsvp: false })).toEqual([]);
    expect(availableActions(b, null)).toEqual([]);
  });
});
