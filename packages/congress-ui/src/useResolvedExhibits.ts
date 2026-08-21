import { useQueries } from "@tanstack/react-query";
import { buildExhibitToken, parseExhibitToken } from "@congress/shared-types";
import type { CapitolExhibitResolveResult, ExhibitToken } from "@congress/shared-types";

const RESOLVE_URL = "/congress/exhibits/resolve";

// Coalesces every resolve request made anywhere in the app within one short
// window into a single POST /congress/exhibits/resolve call - shared
// module-level state, not scoped to one hook instance, so two different
// pieces of text (even in different Chambers) referencing the same exhibit
// token resolve it once between them instead of once each. Congress-ui is
// now built as one shared vendor chunk (see
// services/congress/frontend/src/vendor/congress-ui.ts), so this module
// really does have exactly one live instance across the whole app.
const BATCH_WINDOW_MS = 10;

interface PendingEntry {
  ref: ExhibitToken;
  resolve: (result: CapitolExhibitResolveResult) => void;
  reject: (err: unknown) => void;
}

let pending: PendingEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushPending(): void {
  const batch = pending;
  pending = [];
  flushTimer = null;

  fetch(RESOLVE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refs: batch.map((entry) => entry.ref) }),
  })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`resolve failed: ${res.status}`))))
    .then((data: { results: CapitolExhibitResolveResult[] }) => {
      const byToken = new Map<string, CapitolExhibitResolveResult>();
      for (const result of data.results) {
        byToken.set(buildExhibitToken({ chamber: result.chamber, id: result.id }), result);
      }
      for (const entry of batch) {
        const result = byToken.get(buildExhibitToken(entry.ref));
        entry.resolve(result ?? { ...entry.ref, unavailable: true });
      }
    })
    .catch((err) => {
      for (const entry of batch) entry.reject(err);
    });
}

function scheduleResolve(ref: ExhibitToken): Promise<CapitolExhibitResolveResult> {
  return new Promise((resolve, reject) => {
    pending.push({ ref, resolve, reject });
    flushTimer ??= setTimeout(flushPending, BATCH_WINDOW_MS);
  });
}

// Resolves a set of `exhibit:chamber:id` tokens (see
// extractExhibitTokens/splitExhibitText) into their current display data,
// keyed back by the same token string so callers can look results up
// directly. Used by both NoteMarkdown (Markdown rendering) and
// ExhibitAnnotatedText (plain-text rendering) - the resolve logic is
// identical between them, only how the result gets rendered differs.
// Routed through React Query (keyed per token, not per call site's whole
// token set) rather than a raw fetch+useState: the same token commonly
// appears across many separately-rendered items on one page, so per-token
// caching is what actually removes the duplicate work - a set-keyed cache
// would only dedupe two call sites requesting the exact same set. The
// per-request batching above keeps the "one POST for everything requested
// right now" behavior the old set-keyed version had, just decoupled from
// which component happened to ask.
export function useResolvedExhibits(tokens: string[]): {
  resultsByToken: Map<string, CapitolExhibitResolveResult>;
  loading: boolean;
} {
  const refs = tokens
    .map((token) => ({ token, ref: parseExhibitToken(token) }))
    .filter((entry): entry is { token: string; ref: ExhibitToken } => entry.ref !== null);

  const results = useQueries({
    queries: refs.map(({ token, ref }) => ({
      queryKey: ["exhibit-resolve", token],
      queryFn: () => scheduleResolve(ref),
      // Exhibit name/url/deleted-state changes are rare relative to how
      // often the same chip re-renders (scrolling, sibling resolves
      // settling, ...) - a minute of staleness is a fine trade for not
      // refetching on every one of those.
      staleTime: 60_000,
    })),
  });

  const resultsByToken = new Map<string, CapitolExhibitResolveResult>();
  let loading = false;
  results.forEach((result, i) => {
    if (result.isLoading) loading = true;
    if (result.data) resultsByToken.set(refs[i]!.token, result.data);
  });

  return { resultsByToken, loading };
}
