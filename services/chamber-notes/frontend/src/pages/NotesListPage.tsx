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
import { fetchNotes, fetchNote, searchNotes } from "@/lib/api";
import type { NoteSummary } from "../../../src/types";

function sortPinnedFirst(notes: NoteSummary[]): NoteSummary[] {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

export function NotesListPage() {
  const [query, setQuery] = useState("");
  const shellHosted = useShellHosted();

  const { data, isLoading, isError } = useSearchableList({
    queryKeyBase: "notes",
    query,
    fetchAll: fetchNotes,
    fetchSearch: searchNotes,
  });

  const notes = data ? sortPinnedFirst(data) : data;

  const prefetchNote = useListRowPrefetch((id: number) => ["note", id], fetchNote);

  return (
    <section className="list-page">
      <ListSearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search notes —"
        newHref={resolveChamberPath("/new", "notes", shellHosted)}
      />

      {isLoading && <ListLoadingState />}
      {isError && <ListErrorState label="Notes" />}
      {!isLoading && !isError && notes?.length === 0 && <ListEmptyState label="notes" hasQuery={!!query} />}
      {!isLoading && !isError && notes && notes.length > 0 && (
        <div className="notes-flow">
          {notes.map((note) => (
            <Link
              key={note.id}
              to={resolveChamberPath(`/n/${note.id}`, "notes", shellHosted)}
              onMouseEnter={() => prefetchNote(note.id)}
              onFocus={() => prefetchNote(note.id)}
              className="note-card"
            >
              {note.pinned && (
                <span className="note-card-pin font-mono text-xs" aria-label="Pinned">
                  *
                </span>
              )}
              <span
                className={`block font-display text-base text-ink ${note.pinned ? "pl-3.5" : ""}`}
              >
                {note.title}
              </span>
              {note.excerpt && <p className="note-card-excerpt mt-1 line-clamp-2 text-xs text-slate">{note.excerpt}</p>}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
