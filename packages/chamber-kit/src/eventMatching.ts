import { PRIORITY_LEVELS, priorityLevelSchema, type PriorityLevel } from "@congress/shared-types";

// The handful of rules every Chamber that consumes Congress's event relay
// has to agree on: how a dotted path is read out of a payload, how a
// `{{payload.x}}` template is filled in, and how `payload.priority` compares
// against a threshold.
//
// These lived as byte-identical private copies in chamber-logs and
// chamber-automation (getPath/interpolate) and in a third near-identical
// form in Congress itself and chamber-logs' own eventHistory (priority
// ranking). Three copies of a matching rule is three chances for them to
// drift apart silently, which for a relay means events quietly stop
// reaching a subscriber - so they live here now, written and tested once.

// Reads a dotted path ("a.b.c") out of a plain object, returning undefined
// for any missing/non-object segment.
export function getPath(payload: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), payload);
}

// Plain {{payload.x}}/{{payload.a.b}} interpolation - no templating library,
// no arbitrary expressions, just a dotted-path lookup against the firing
// event's own payload. A path that resolves to null/undefined renders as the
// empty string rather than "null"/"undefined"; anything the pattern doesn't
// match is left in the string verbatim.
export function interpolate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{\s*payload\.([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, path: string) => {
    const value = getPath(payload, path);
    return value === undefined || value === null ? "" : String(value);
  });
}

// Position in PRIORITY_LEVELS (low < normal < high < urgent). An
// unset/unrecognized level ranks as "normal", matching the convention that
// a publishing Chamber which didn't set a priority is treated as normal
// rather than as the bottom of the scale.
export function priorityRank(level: PriorityLevel | undefined): number {
  const rank = PRIORITY_LEVELS.indexOf(level ?? "normal");
  return rank === -1 ? PRIORITY_LEVELS.indexOf("normal") : rank;
}

export function priorityLevelForRank(rank: number): PriorityLevel {
  return PRIORITY_LEVELS[rank] ?? "normal";
}

// payload.priority is a convention (PRIORITY_LEVELS, shared-types), not
// enforced by Congress - anything missing or unrecognized defaults to
// "normal" rather than rejecting the event.
export function priorityOf(payload: Record<string, unknown>): PriorityLevel {
  const parsed = priorityLevelSchema.safeParse(payload.priority);
  return parsed.success ? parsed.data : "normal";
}

// ">=" is deliberately the only comparison a threshold supports anywhere in
// this system - priority is an ordered field, not an arbitrary one, so
// "exactly high" is never a thing an owner can ask for.
export function priorityAtLeast(priority: PriorityLevel, threshold: PriorityLevel | undefined): boolean {
  return priorityRank(priority) >= priorityRank(threshold);
}
