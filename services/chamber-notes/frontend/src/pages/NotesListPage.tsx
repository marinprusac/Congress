import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchNotes, searchNotes, setPinned } from "@/lib/api";
import type { NoteSummary } from "@congress/shared-types";

function formatTimestamp(value: string): string {
  return new Date(value).toISOString().replace("T", " ").slice(0, 16);
}

function sortPinnedFirst(notes: NoteSummary[]): NoteSummary[] {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

export function NotesListPage() {
  const [query, setQuery] = useState("");
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: query ? ["notes", "search", query] : ["notes"],
    queryFn: () => (query ? searchNotes(query) : fetchNotes()),
  });

  const pinMutation = useMutation({
    mutationFn: ({ id, pinned }: { id: number; pinned: boolean }) => setPinned(id, pinned),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      queryClient.invalidateQueries({ queryKey: ["notes", "pinned"] });
    },
  });

  const notes = data ? sortPinnedFirst(data) : data;

  return (
    <section>
      <input
        type="search"
        placeholder="Search notes —"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-6 w-full border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
      />

      <div className="border-t border-dust">
        {isLoading && <div className="px-1 py-3 font-mono text-sm text-dust">Loading —</div>}
        {isError && (
          <div className="px-1 py-3 font-mono text-sm text-alert">Failed to reach the Notes API.</div>
        )}
        {!isLoading && !isError && notes?.length === 0 && (
          <div className="border-b border-dust px-1 py-3 font-mono text-sm text-dust">
            — No notes {query ? "match your search" : "yet"} —
          </div>
        )}
        {!isLoading &&
          !isError &&
          notes?.map((note) => (
            <div key={note.id} className="flex items-baseline gap-3 border-b border-dust px-1 py-3">
              <Link to={`/n/${note.id}`} className="min-w-0 flex-1 hover:bg-ink/[0.03]">
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
                className="shrink-0 font-mono text-xs uppercase tracking-wide text-dust hover:text-accent"
              >
                {note.pinned ? "Unpin" : "Pin"}
              </button>
            </div>
          ))}
      </div>
    </section>
  );
}
