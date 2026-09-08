import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@congress/congress-ui";
import { fetchHealthMetrics } from "@/lib/api";
import type { HealthMetric, HealthMetricType } from "../../../src/types";

const SECTIONS: { type: HealthMetricType; label: string; format: (m: HealthMetric) => string }[] = [
  { type: "weight", label: "Weight", format: (m) => `${m.value} ${m.unit}` },
  { type: "sleepAsleep", label: "Sleep", format: (m) => `${(m.value / 3600).toFixed(1)} h` },
  { type: "activeEnergy", label: "Active Energy", format: (m) => `${Math.round(m.value)} ${m.unit}` },
  { type: "restingEnergy", label: "Resting Energy", format: (m) => `${Math.round(m.value)} ${m.unit}` },
  { type: "vo2Max", label: "VO2max", format: (m) => `${m.value} ${m.unit}` },
];

function MetricSection({ type, label, format }: (typeof SECTIONS)[number]) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["health", "metrics", type],
    queryFn: () => fetchHealthMetrics(type, 20),
  });

  return (
    <section className="mb-8 border-t border-dust pt-4">
      <p className="mb-3 font-mono text-xs uppercase tracking-wide text-dust">{label}</p>
      {isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
      {isError && <p className="font-mono text-sm text-alert">Unavailable.</p>}
      {!isLoading && !isError && data?.length === 0 && (
        <p className="font-mono text-sm text-dust">— No data synced yet —</p>
      )}
      {!isLoading && !isError && data && data.length > 0 && (
        <>
          <p className="mb-3 font-display text-2xl text-ink">{format(data[0]!)}</p>
          <ul className="divide-y divide-dust/50">
            {data.map((m) => (
              <li key={m.id} className="flex items-baseline justify-between py-2 font-mono text-sm">
                <span className="text-slate">{new Date(m.startDate).toLocaleString()}</span>
                <span className="text-ink">{format(m)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function HealthPage() {
  return (
    <section>
      <PageHeader title="Health" />
      {SECTIONS.map((section) => (
        <MetricSection key={section.type} {...section} />
      ))}
    </section>
  );
}
