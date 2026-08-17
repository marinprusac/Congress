import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { WidgetPreviewShell, useShellHosted, resolveChamberPath } from "@congress/congress-ui";
import { fetchPinnedNotes } from "@/lib/api";

export function PinnedNotesWidget() {
  const shellHosted = useShellHosted();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["notes", "pinned"],
    queryFn: fetchPinnedNotes,
  });

  return (
    <WidgetPreviewShell
      label="Pinned"
      addHref="/new"
      ownChamber="notes"
      isLoading={isLoading}
      isError={isError}
      errorLabel="Notes unavailable."
      isEmpty={(data?.length ?? 0) === 0}
      emptyLabel="— No pinned notes —"
    >
      <div className="notes-flow">
        {data?.map((note) => (
          <Link
            key={note.id}
            to={resolveChamberPath(`/n/${note.id}`, "notes", shellHosted)}
            className="note-card note-card-mini"
          >
            <span className="block font-display text-sm text-ink">{note.title}</span>
          </Link>
        ))}
      </div>
    </WidgetPreviewShell>
  );
}
