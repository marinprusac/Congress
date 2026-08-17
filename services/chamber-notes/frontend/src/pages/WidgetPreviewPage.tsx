import { useQuery } from "@tanstack/react-query";
import { WidgetPreviewShell } from "@congress/congress-ui";
import { fetchPinnedNotes } from "@/lib/api";

export function WidgetPreviewPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["notes", "pinned"],
    queryFn: fetchPinnedNotes,
  });

  return (
    <WidgetPreviewShell
      label="Pinned"
      addHref="/notes/new"
      isLoading={isLoading}
      isError={isError}
      errorLabel="Notes unavailable."
      isEmpty={(data?.length ?? 0) === 0}
      emptyLabel="— No pinned notes —"
    >
      <div className="notes-flow">
        {data?.map((note) => (
          <a key={note.id} href={`/notes/n/${note.id}`} target="_top" className="note-card note-card-mini">
            <span className="block font-display text-sm text-ink">{note.title}</span>
          </a>
        ))}
      </div>
    </WidgetPreviewShell>
  );
}
