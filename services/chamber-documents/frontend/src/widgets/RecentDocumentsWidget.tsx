import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { WidgetPreviewShell, useShellHosted, resolveChamberPath } from "@congress/congress-ui";
import { fetchDocuments } from "@/lib/api";

const WIDGET_LIMIT = 6;

export function RecentDocumentsWidget() {
  const shellHosted = useShellHosted();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["documents"],
    queryFn: fetchDocuments,
  });

  const recent = data?.slice(0, WIDGET_LIMIT);

  return (
    <WidgetPreviewShell
      label="Recent"
      addHref="/new"
      addLabel="+ Upload"
      ownChamber="documents"
      isLoading={isLoading}
      isError={isError}
      errorLabel="Documents unavailable."
      isEmpty={(recent?.length ?? 0) === 0}
      emptyLabel="— No documents —"
    >
      {recent?.map((doc) => (
        <Link
          key={doc.id}
          to={resolveChamberPath(`/d/${doc.id}`, "documents", shellHosted)}
          className="block border-b border-dust py-1.5 font-display text-sm text-ink first:pt-0 last:border-b-0 hover:text-accent"
        >
          {doc.title}
        </Link>
      ))}
    </WidgetPreviewShell>
  );
}
