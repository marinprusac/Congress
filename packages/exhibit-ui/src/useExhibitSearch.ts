import { useEffect, useRef, useState } from "react";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";

const DEBOUNCE_MS = 150;

// Relative path - resolves through Capitol directly, same-origin in prod
// (each Chamber's frontend is served under Capitol's proxy) and via a dev
// proxy rule for "/capitol" in each Chamber's vite.config.ts locally.
const SEARCH_URL = "/capitol/exhibits/search";

export function useExhibitSearch(query: string): {
  results: CapitolExhibitSearchResult[];
  loading: boolean;
} {
  const [results, setResults] = useState<CapitolExhibitSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    if (!query.trim()) {
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
  }, [query]);

  return { results, loading };
}
