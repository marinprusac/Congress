import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { WidgetPreviewShell, useShellHosted, resolveChamberPath } from "@congress/congress-ui";
import { fetchRecentItems } from "@/lib/api";

export function RecentItemsWidget() {
  const shellHosted = useShellHosted();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["items", "recent"],
    queryFn: fetchRecentItems,
  });

  return (
    <WidgetPreviewShell
      label="Recent"
      addHref="/new"
      ownChamber="__CHAMBER_NAME__"
      isLoading={isLoading}
      isError={isError}
      errorLabel="__CHAMBER_DISPLAY__ unavailable."
      isEmpty={(data?.length ?? 0) === 0}
      emptyLabel="— No items yet —"
    >
      {data?.map((item) => (
        <Link
          key={item.id}
          to={resolveChamberPath(`/i/${item.id}`, "__CHAMBER_NAME__", shellHosted)}
          className="flex items-baseline justify-between gap-2 border-b border-dust py-1.5 font-display text-sm text-ink first:pt-0 last:border-b-0 hover:text-accent"
        >
          <span className="min-w-0 truncate">{item.name}</span>
        </Link>
      ))}
    </WidgetPreviewShell>
  );
}
