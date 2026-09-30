// The handful of rules every Chamber that consumes Congress's event relay
// has to agree on: how a dotted path is read out of a payload, and how a
// `{{payload.x}}` template is filled in.
//
// These lived as byte-identical private copies in chamber-logs and
// chamber-automation. Two copies of a matching rule is two chances for them
// to drift apart silently, which for a relay means events quietly stop
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
// match is left in the string verbatim. An array/object value is rendered as
// JSON rather than via `String()` - `String([...])` comma-joins elements
// (lossy for arrays of objects, and not valid JSON), which matters because
// `buildArgs` in chamber-automation feeds this straight into `JSON.parse` to
// pass a whole payload field through as a tool argument.
export function interpolate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{\s*payload\.([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, path: string) => {
    const value = getPath(payload, path);
    if (value === undefined || value === null) return "";
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  });
}
