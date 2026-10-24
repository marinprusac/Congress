// A reference to a Record, encoded as the "target" half of the existing
// `[[target|alias]]` bracket syntax - e.g. `record:notes:note-123`. Pure
// string helpers (no React) so both frontend and backend code can use them
// without pulling in a UI package.
export const RECORD_TOKEN_PREFIX = "record:";
// Written before records were called records; still read, never written.
const LEGACY_TOKEN_PREFIX = "exhibit:";

export interface RecordToken {
  chamber: string;
  id: string;
}

export function buildRecordToken({ chamber, id }: RecordToken): string {
  return `${RECORD_TOKEN_PREFIX}${chamber}:${id}`;
}

export function parseRecordToken(target: string): RecordToken | null {
  const prefix = [RECORD_TOKEN_PREFIX, LEGACY_TOKEN_PREFIX].find((p) => target.startsWith(p));
  if (!prefix) return null;
  const rest = target.slice(prefix.length);
  const separatorIndex = rest.indexOf(":");
  if (separatorIndex === -1) return null;
  const chamber = rest.slice(0, separatorIndex);
  const id = rest.slice(separatorIndex + 1);
  if (!chamber || !id) return null;
  return { chamber, id };
}

// The full `[[record:chamber:id|Name]]` bracket token ready to paste into a
// note/task/document body - buildRecordToken only builds the inner
// `record:chamber:id` target half; this wraps it in the same `[[target|alias]]`
// syntax the "[[" picker hand-rolls on insert (see congress-ui's
// useRecordPicker.ts), so there is one named place defining what a pasted
// chip looks like.
export function buildChipToken({ chamber, id, name }: RecordToken & { name: string }): string {
  return `[[${buildRecordToken({ chamber, id })}|${name}]]`;
}
