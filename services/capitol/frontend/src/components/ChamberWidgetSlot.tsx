import { useQuery } from "@tanstack/react-query";
import { fetchChamberWidget } from "@/lib/api";
import type { ChamberStatus } from "@congress/shared-types";

interface ChamberWidgetSlotProps {
  chamberName: string;
  status: ChamberStatus;
}

export function ChamberWidgetSlot({ chamberName, status }: ChamberWidgetSlotProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["widget", chamberName],
    queryFn: () => fetchChamberWidget(chamberName),
    enabled: status === "active",
    retry: 0,
  });

  if (status !== "active") {
    return (
      <p className="pl-1 font-mono text-xs text-dust">— offline, widget unavailable —</p>
    );
  }

  if (isLoading) {
    return <p className="pl-1 font-mono text-xs text-dust">loading widget —</p>;
  }

  if (isError || !data) {
    return <p className="pl-1 font-mono text-xs text-dust">— no widget data —</p>;
  }

  return (
    <div className="pl-1">
      <p className="font-mono text-xs text-slate">{data.summary}</p>
      {data.items.length > 0 && (
        <ul className="mt-1">
          {data.items.map((item, i) => (
            <li key={i} className="font-mono text-xs text-dust">
              · {item.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
