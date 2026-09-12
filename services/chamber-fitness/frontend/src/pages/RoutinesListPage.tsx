import { useState } from "react";
import {
  useShellHosted,
  resolveChamberPath,
  useSearchableList,
  useListRowPrefetch,
  ListSearchInput,
  ListErrorState,
  ListEmptyState,
  CompactCard,
  CardFlow,
  CardFlowLoadingState,
} from "@congress/congress-ui";
import { fetchRoutines, fetchRoutine } from "@/lib/api";

export function RoutinesListPage() {
  const [query, setQuery] = useState("");
  const shellHosted = useShellHosted();

  const { data, isLoading, isError } = useSearchableList({
    queryKeyBase: "routines",
    query,
    fetchAll: fetchRoutines,
    filterClient: (routine, q) => routine.title.toLowerCase().includes(q),
  });

  const prefetchRoutine = useListRowPrefetch((id: string) => ["routine", id], fetchRoutine);

  return (
    <section className="list-page">
      <ListSearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search routines —"
        newHref={resolveChamberPath("/routines/new", "fitness", shellHosted)}
      />

      <div className="mt-4">
        {isLoading && <CardFlowLoadingState />}
        {isError && <ListErrorState label="Routines" />}
        {!isLoading && !isError && data?.length === 0 && <ListEmptyState label="routines" hasQuery={!!query} />}
        {!isLoading && !isError && data && data.length > 0 && (
          <CardFlow>
            {data.map((routine) => (
              <CompactCard
                key={routine.id}
                href={resolveChamberPath(`/routines/${routine.id}`, "fitness", shellHosted)}
                onMouseEnter={() => prefetchRoutine(routine.id)}
                onFocus={() => prefetchRoutine(routine.id)}
                title={routine.title}
                subtitle={`${routine.exerciseCount} exercise${routine.exerciseCount === 1 ? "" : "s"}`}
              />
            ))}
          </CardFlow>
        )}
      </div>
    </section>
  );
}
