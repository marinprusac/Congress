import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchNotes, searchNotes } from "@/lib/api";

function formatTimestamp(value: string): string {
  return new Date(value).toISOString().replace("T", " ").slice(0, 16);
}

export function NotesListPage() {
  const [query, setQuery] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: query ? ["notes", "search", query] : ["notes"],
    queryFn: () => (query ? searchNotes(query) : fetchNotes()),
  });

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
        {!isLoading && !isError && data?.length === 0 && (
          <div className="border-b border-dust px-1 py-3 font-mono text-sm text-dust">
            — No notes {query ? "match your search" : "yet"} —
          </div>
        )}
        {!isLoading &&
          !isError &&
          data?.map((note) => (
            <Link
              key={note.id}
              to={`/n/${note.id}`}
              className="block border-b border-dust px-1 py-3 hover:bg-ink/[0.03]"
            >
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-display text-lg text-ink">{note.title}</span>
                <span className="shrink-0 font-mono text-xs text-dust">
                  {formatTimestamp(note.updatedAt)}
                </span>
              </div>
              {note.excerpt && <p className="mt-1 text-sm text-slate">{note.excerpt}</p>}
            </Link>
          ))}
      </div>
    </section>
  );
}
