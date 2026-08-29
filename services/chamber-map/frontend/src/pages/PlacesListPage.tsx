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
import { fetchPlaces, fetchPlace, searchPlaces } from "@/lib/api";

export function PlacesListPage() {
  const [query, setQuery] = useState("");
  const shellHosted = useShellHosted();

  const { data, isLoading, isError } = useSearchableList({
    queryKeyBase: "places",
    query,
    fetchAll: fetchPlaces,
    fetchSearch: searchPlaces,
  });

  const prefetchPlace = useListRowPrefetch((id: number) => ["place", id], fetchPlace);

  return (
    <section className="list-page">
      <ListSearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search places —"
        newHref={resolveChamberPath("/places/new", "map", shellHosted)}
      />

      <div className="border-t border-dust">
        {isLoading && <ListLoadingState />}
        {isError && <ListErrorState label="Places" />}
        {!isLoading && !isError && data?.length === 0 && <ListEmptyState label="places" hasQuery={!!query} />}
        {!isLoading &&
          !isError &&
          data?.map((place) => (
            <Link
              key={place.id}
              to={resolveChamberPath(`/p/${place.id}`, "map", shellHosted)}
              onMouseEnter={() => prefetchPlace(place.id)}
              onFocus={() => prefetchPlace(place.id)}
              className="block border-b border-dust px-1 py-3 hover:bg-ink/[0.03]"
            >
              <span className="font-display text-lg text-ink">{place.name}</span>
            </Link>
          ))}
      </div>
    </section>
  );
}
