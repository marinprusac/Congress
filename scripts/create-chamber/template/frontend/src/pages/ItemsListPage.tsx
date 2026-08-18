import { Link } from "react-router-dom";
import { useState } from "react";
import {
  useShellHosted,
  resolveChamberPath,
  useSearchableList,
  useListRowPrefetch,
  ListSearchInput,
  ListLoadingState,
  ListErrorState,
  ListEmptyState,
} from "@congress/congress-ui";
import { fetchItems, fetchItem, searchItems } from "@/lib/api";

export function ItemsListPage() {
  const [query, setQuery] = useState("");
  const shellHosted = useShellHosted();

  const { data, isLoading, isError } = useSearchableList({
    queryKeyBase: "items",
    query,
    fetchAll: fetchItems,
    fetchSearch: searchItems,
  });

  const prefetchItem = useListRowPrefetch((id: number) => ["item", id], fetchItem);

  return (
    <section className="list-page">
      <ListSearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search __CHAMBER_NAME__ —"
        newHref={resolveChamberPath("/new", "__CHAMBER_NAME__", shellHosted)}
      />

      <div className="border-t border-dust">
        {isLoading && <ListLoadingState />}
        {isError && <ListErrorState label="Items" />}
        {!isLoading && !isError && data?.length === 0 && <ListEmptyState label="items" hasQuery={!!query} />}
        {!isLoading &&
          !isError &&
          data?.map((item) => (
            <Link
              key={item.id}
              to={resolveChamberPath(`/i/${item.id}`, "__CHAMBER_NAME__", shellHosted)}
              onMouseEnter={() => prefetchItem(item.id)}
              onFocus={() => prefetchItem(item.id)}
              className="block border-b border-dust px-1 py-3 hover:bg-ink/[0.03]"
            >
              <span className="font-display text-lg text-ink">{item.name}</span>
              {item.body && <p className="mt-1 text-sm text-slate">{item.body}</p>}
            </Link>
          ))}
      </div>
    </section>
  );
}
