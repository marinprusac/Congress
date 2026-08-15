import { useQuery } from "@tanstack/react-query";
import { WidgetPreviewShell } from "@congress/congress-ui";
import { fetchRecentItems } from "@/lib/api";

export function WidgetPreviewPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["items", "recent"],
    queryFn: fetchRecentItems,
  });

  return (
    <WidgetPreviewShell
      label="Recent"
      addHref="/__CHAMBER_NAME__/new"
      isLoading={isLoading}
      isError={isError}
      errorLabel="__CHAMBER_DISPLAY__ unavailable."
      isEmpty={(data?.length ?? 0) === 0}
      emptyLabel="— No items yet —"
    >
      {data?.map((item) => (
        <a
          key={item.id}
          href={`/__CHAMBER_NAME__/i/${item.id}`}
          target="_top"
          className="flex items-baseline justify-between gap-2 border-b border-dust py-1.5 font-display text-sm text-ink first:pt-0 last:border-b-0 hover:text-accent"
        >
          <span className="min-w-0 truncate">{item.name}</span>
        </a>
      ))}
    </WidgetPreviewShell>
  );
}
