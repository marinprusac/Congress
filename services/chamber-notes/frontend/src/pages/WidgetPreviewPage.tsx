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
      {data?.map((note) => (
        <a
          key={note.id}
          href={`/notes/n/${note.id}`}
          target="_top"
          className="block border-b border-dust py-1.5 font-display text-sm text-ink first:pt-0 last:border-b-0 hover:text-accent"
        >
          {note.title}
        </a>
      ))}
    </WidgetPreviewShell>
  );
}
