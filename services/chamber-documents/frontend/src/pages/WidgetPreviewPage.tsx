import { useQuery } from "@tanstack/react-query";
import { WidgetPreviewShell } from "@congress/exhibit-ui";
import { fetchDocuments } from "@/lib/api";

const WIDGET_LIMIT = 6;

export function WidgetPreviewPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["documents"],
    queryFn: fetchDocuments,
  });

  const recent = data?.slice(0, WIDGET_LIMIT);

  return (
    <WidgetPreviewShell
      label="Recent"
      addHref="/documents/new"
      addLabel="+ Upload"
      isLoading={isLoading}
      isError={isError}
      errorLabel="Documents unavailable."
      isEmpty={(recent?.length ?? 0) === 0}
      emptyLabel="— No documents —"
    >
      {recent?.map((doc) => (
        <a
          key={doc.id}
          href={`/documents/d/${doc.id}`}
          target="_top"
          className="block border-b border-dust py-1.5 font-display text-sm text-ink first:pt-0 last:border-b-0 hover:text-accent"
        >
          {doc.title}
        </a>
      ))}
    </WidgetPreviewShell>
  );
}
