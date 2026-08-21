import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useCallback } from "react";

export interface SearchableListOptions<T> {
  queryKeyBase: string;
  query: string;
  fetchAll: () => Promise<T[]>;
  // Server-search mode (Notes, Tasks): branches the query key on `query`.
  fetchSearch?: (query: string) => Promise<T[]>;
  // Client-filter mode (Documents): fetches once, filters in JS.
  filterClient?: (item: T, query: string) => boolean;
}

// One unconditional useQuery call regardless of which mode this call site
// uses - the query key/fn are simply computed differently going in. The
// previous version called useQuery from inside an `if (fetchSearch)` branch
// and returned early, which is safe only because a given call site always
// passes the same fetchSearch/filterClient shape across renders (it's
// determined by which page is calling, not by props that vary
// render-to-render) - but it's a hooks-order violation waiting for the
// first call site that doesn't hold that invariant, and React gives no
// warning until it does.
export function useSearchableList<T>(opts: SearchableListOptions<T>) {
  const { queryKeyBase, query, fetchAll, fetchSearch, filterClient } = opts;

  const searching = Boolean(fetchSearch && query);
  const result = useQuery({
    queryKey: searching ? [queryKeyBase, "search", query] : [queryKeyBase],
    queryFn: searching ? () => fetchSearch!(query) : fetchAll,
  });

  const q = query.trim().toLowerCase();
  const data =
    !fetchSearch && result.data && filterClient && q ? result.data.filter((item) => filterClient(item, q)) : result.data;
  return { ...result, data };
}

export function useListRowPrefetch<TId>(queryKeyFor: (id: TId) => QueryKey, fetchOne: (id: TId) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useCallback(
    (id: TId) => queryClient.prefetchQuery({ queryKey: queryKeyFor(id), queryFn: () => fetchOne(id) }),
    [queryClient, queryKeyFor, fetchOne]
  );
}
