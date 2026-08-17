import { useEffect, useRef, useState } from "react";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";

const DEBOUNCE_MS = 150;

// Relative path - resolves through Congress directly, same-origin in prod
// (each Chamber's frontend is served under Congress's proxy) and via a dev
// proxy rule for "/congress" in each Chamber's vite.config.ts locally.
const SEARCH_URL = "/congress/exhibits/search";

// An empty query is a real query, not a no-op: it asks for the most recent
// Exhibits, so typing "[[" immediately shows a browsable list rather than
// an unhelpful "No matches". `enabled` (rather than a non-empty query) is
// what gates fetching.
export function useExhibitSearch(
  query: string,
  enabled: boolean
): {
  results: CapitolExhibitSearchResult[];
  loading: boolean;
} {
  const [results, setResults] = useState<CapitolExhibitSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${SEARCH_URL}?q=${encodeURIComponent(query)}`);
        if (id !== requestId.current) return;
        if (!res.ok) {
          setResults([]);
          return;
        }
        const data = (await res.json()) as { results: CapitolExhibitSearchResult[] };
        if (id !== requestId.current) return;
        setResults(data.results);
      } catch {
        if (id === requestId.current) setResults([]);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, enabled]);

  return { results, loading };
}
