import { useQuery } from "@tanstack/react-query";
import { fetchRegistry } from "@/lib/api";
import { ChamberWidgetSlot } from "@/components/ChamberWidgetSlot";

function docketLabel(index: number, name: string): string {
  const number = String(index + 1).padStart(2, "0");
  return `CH.${number} — ${name.toUpperCase()}`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toISOString().replace("T", " ").replace("Z", " UTC");
}

export function ChamberLedger() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["capitol", "registry"],
    queryFn: fetchRegistry,
  });

  return (
    <section>
      <h2 className="font-display text-2xl text-ink mb-4">Module Registry</h2>
      <div className="border-t border-dust">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 border-b border-dust px-1 py-2 font-mono text-xs uppercase tracking-wide text-dust">
          <span>Docket</span>
          <span>Status</span>
          <span>Last Heartbeat</span>
        </div>

        {isLoading && (
          <div className="px-1 py-3 font-mono text-sm text-dust">Loading registry —</div>
        )}

        {isError && (
          <div className="px-1 py-3 font-mono text-sm text-alert">
            Failed to reach Capitol's registry.
          </div>
        )}

        {!isLoading && !isError && data && data.length === 0 && (
          <div className="border-b border-dust px-1 py-3 font-mono text-sm text-dust">
            — No Chambers registered —
          </div>
        )}

        {!isLoading &&
          !isError &&
          data &&
          data.map((chamber, index) => (
            <div key={chamber.name} className="border-b border-dust px-1 py-2">
              <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-6">
                <span className="font-mono text-sm text-ink">
                  {docketLabel(index, chamber.name)}
                </span>
                <span
                  className={`font-mono text-sm ${
                    chamber.status === "active" ? "text-accent" : "text-alert"
                  }`}
                >
                  {chamber.status}
                </span>
                <span className="font-mono text-sm text-slate">
                  {formatTimestamp(chamber.lastHeartbeatAt)}
                </span>
              </div>
              <div className="mt-2">
                <ChamberWidgetSlot chamberName={chamber.name} status={chamber.status} />
              </div>
            </div>
          ))}
      </div>
    </section>
  );
}
