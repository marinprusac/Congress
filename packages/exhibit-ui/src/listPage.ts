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

// A given call site always passes the same fetchSearch/filterClient shape
// across renders (it's determined by which page is calling, not by props
// that vary render-to-render), so branching before the hook call below is
// stable per component instance despite looking conditional.
export function useSearchableList<T>(opts: SearchableListOptions<T>) {
  const { queryKeyBase, query, fetchAll, fetchSearch, filterClient } = opts;

  if (fetchSearch) {
    return useQuery({
      queryKey: query ? [queryKeyBase, "search", query] : [queryKeyBase],
      queryFn: () => (query ? fetchSearch(query) : fetchAll()),
    });
  }

  const result = useQuery({ queryKey: [queryKeyBase], queryFn: fetchAll });
  const q = query.trim().toLowerCase();
  const data = result.data && filterClient && q ? result.data.filter((item) => filterClient(item, q)) : result.data;
  return { ...result, data };
}

export function useListRowPrefetch<TId>(queryKeyFor: (id: TId) => QueryKey, fetchOne: (id: TId) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useCallback(
    (id: TId) => queryClient.prefetchQuery({ queryKey: queryKeyFor(id), queryFn: () => fetchOne(id) }),
    [queryClient, queryKeyFor, fetchOne]
  );
}
