import { useMutation, useQueryClient } from "@tanstack/react-query";
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
  formatTimestamp,
} from "@congress/exhibit-ui";
import { fetchNotes, fetchNote, searchNotes, setPinned } from "@/lib/api";
import type { NoteSummary } from "../../../src/types";

function sortPinnedFirst(notes: NoteSummary[]): NoteSummary[] {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

export function NotesListPage() {
  const [query, setQuery] = useState("");
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useSearchableList({
    queryKeyBase: "notes",
    query,
    fetchAll: fetchNotes,
    fetchSearch: searchNotes,
  });

  const pinMutation = useMutation({
    mutationFn: ({ id, pinned }: { id: number; pinned: boolean }) => setPinned(id, pinned),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      queryClient.invalidateQueries({ queryKey: ["notes", "pinned"] });
    },
  });

  const notes = data ? sortPinnedFirst(data) : data;

  const prefetchNote = useListRowPrefetch((id: number) => ["note", id], fetchNote);

  return (
    <section>
      <ListSearchInput value={query} onChange={setQuery} placeholder="Search notes —" />

      <div className="border-t border-dust">
        {isLoading && <ListLoadingState />}
        {isError && <ListErrorState label="Notes" />}
        {!isLoading && !isError && notes?.length === 0 && <ListEmptyState label="notes" hasQuery={!!query} />}
        {!isLoading &&
          !isError &&
          notes?.map((note) => (
            <div key={note.id} className="flex items-baseline gap-3 border-b border-dust px-1 py-3">
              <Link
                to={resolveChamberPath(`/n/${note.id}`, "notes", shellHosted)}
                onMouseEnter={() => prefetchNote(note.id)}
                onFocus={() => prefetchNote(note.id)}
                className="min-w-0 flex-1 hover:bg-ink/[0.03]"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-display text-lg text-ink">
                    {note.pinned && <span className="mr-1.5 text-accent">*</span>}
                    {note.title}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-dust">
                    {formatTimestamp(note.updatedAt)}
                  </span>
                </div>
                {note.excerpt && <p className="mt-1 text-sm text-slate">{note.excerpt}</p>}
              </Link>
              <button
                type="button"
                onClick={() => pinMutation.mutate({ id: note.id, pinned: !note.pinned })}
                className="tap-target shrink-0 font-mono text-xs uppercase tracking-wide text-dust hover:text-accent"
              >
                {note.pinned ? "Unpin" : "Pin"}
              </button>
            </div>
          ))}
      </div>
    </section>
  );
}
