import { useEffect, useState } from "react";
import { buildExhibitToken, parseExhibitToken } from "@congress/shared-types";
import type { CapitolExhibitResolveResult } from "@congress/shared-types";

const RESOLVE_URL = "/congress/exhibits/resolve";

// Batch-resolves a set of `exhibit:chamber:id` tokens (see
// extractExhibitTokens/splitExhibitText) into their current display data via
// Congress, keyed back by the same token string so callers can look results
// up directly. Used by both NoteMarkdown (Markdown rendering) and
// ExhibitAnnotatedText (plain-text rendering) - the fetch/resolve logic is
// identical between them, only how the result gets rendered differs.
export function useResolvedExhibits(tokens: string[]): {
  resultsByToken: Map<string, CapitolExhibitResolveResult>;
  loading: boolean;
} {
  const [resultsByToken, setResultsByToken] = useState<Map<string, CapitolExhibitResolveResult>>(new Map());
  const [loading, setLoading] = useState(false);
  const key = tokens.join(" ");

  useEffect(() => {
    if (tokens.length === 0) {
      setResultsByToken(new Map());
      return;
    }

    let cancelled = false;
    setLoading(true);

    const refs = tokens.map((token) => parseExhibitToken(token)).filter((t): t is NonNullable<typeof t> => t !== null);

    fetch(RESOLVE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refs }),
    })
      .then((res) => (res.ok ? res.json() : { results: [] }))
      .then((data: { results: CapitolExhibitResolveResult[] }) => {
        if (cancelled) return;
        const map = new Map<string, CapitolExhibitResolveResult>();
        for (const result of data.results) {
          map.set(buildExhibitToken({ chamber: result.chamber, id: result.id }), result);
        }
        setResultsByToken(map);
      })
      .catch(() => {
        if (!cancelled) setResultsByToken(new Map());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { resultsByToken, loading };
}
