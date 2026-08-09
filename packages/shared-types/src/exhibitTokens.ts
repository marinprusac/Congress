// A reference to an Exhibit, encoded as the "target" half of the existing
// `[[target|alias]]` bracket syntax - e.g. `exhibit:notes:note-123`. Pure
// string helpers (no React) so both frontend and backend code can use them
// without pulling in a UI package.
export const EXHIBIT_TOKEN_PREFIX = "exhibit:";

export interface ExhibitToken {
  chamber: string;
  id: string;
}

export function buildExhibitToken({ chamber, id }: ExhibitToken): string {
  return `${EXHIBIT_TOKEN_PREFIX}${chamber}:${id}`;
}

export function parseExhibitToken(target: string): ExhibitToken | null {
  if (!target.startsWith(EXHIBIT_TOKEN_PREFIX)) return null;
  const rest = target.slice(EXHIBIT_TOKEN_PREFIX.length);
  const separatorIndex = rest.indexOf(":");
  if (separatorIndex === -1) return null;
  const chamber = rest.slice(0, separatorIndex);
  const id = rest.slice(separatorIndex + 1);
  if (!chamber || !id) return null;
  return { chamber, id };
}
