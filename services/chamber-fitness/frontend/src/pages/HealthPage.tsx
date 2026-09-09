import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@congress/congress-ui";
import { fetchHealthMetrics } from "@/lib/api";
import type { HealthMetric, HealthMetricType } from "../../../src/types";

interface MetricSectionProps {
  type: HealthMetricType;
  label: string;
  format: (m: HealthMetric) => string;
}

function MetricSection({ type, label, format }: MetricSectionProps) {
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

interface CaloriesRow {
  startDate: string;
  active: number;
  resting: number;
}

// Active and resting energy are two separate metric types in storage (see
// healthMetrics table) - Health Auto Export exports them as one row per
// calendar day each, stamped with the same day-boundary startDate, so
// merging them into one "total calories" row per day is a plain lookup by
// matching startDate, not a fuzzy date-bucketing problem.
function mergeCaloriesByDate(active: HealthMetric[], resting: HealthMetric[]): CaloriesRow[] {
  const byDate = new Map<string, CaloriesRow>();
  for (const m of active) {
    byDate.set(m.startDate, { ...(byDate.get(m.startDate) ?? { startDate: m.startDate, active: 0, resting: 0 }), active: m.value });
  }
  for (const m of resting) {
    byDate.set(m.startDate, { ...(byDate.get(m.startDate) ?? { startDate: m.startDate, active: 0, resting: 0 }), resting: m.value });
  }
  return [...byDate.values()].sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
}

function CaloriesSection() {
  const activeQuery = useQuery({
    queryKey: ["health", "metrics", "activeEnergy"],
    queryFn: () => fetchHealthMetrics("activeEnergy", 20),
  });
  const restingQuery = useQuery({
    queryKey: ["health", "metrics", "restingEnergy"],
    queryFn: () => fetchHealthMetrics("restingEnergy", 20),
  });

  const isLoading = activeQuery.isLoading || restingQuery.isLoading;
  const isError = activeQuery.isError || restingQuery.isError;
  const rows = mergeCaloriesByDate(activeQuery.data ?? [], restingQuery.data ?? []);

  return (
    <section className="mb-8 border-t border-dust pt-4">
      <p className="mb-3 font-mono text-xs uppercase tracking-wide text-dust">Calories</p>
      {isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
      {isError && <p className="font-mono text-sm text-alert">Unavailable.</p>}
      {!isLoading && !isError && rows.length === 0 && (
        <p className="font-mono text-sm text-dust">— No data synced yet —</p>
      )}
      {!isLoading && !isError && rows.length > 0 && (
        <>
          <p className="mb-3 font-display text-2xl text-ink">{Math.round(rows[0]!.active + rows[0]!.resting)} kcal</p>
          <ul className="divide-y divide-dust/50">
            {rows.map((row) => (
              <li key={row.startDate} className="flex items-baseline justify-between py-2 font-mono text-sm">
                <span className="text-slate">{new Date(row.startDate).toLocaleDateString()}</span>
                <span className="text-ink">
                  {Math.round(row.active + row.resting)} kcal
                  <span className="text-dust"> ({Math.round(row.active)} active + {Math.round(row.resting)} resting)</span>
                </span>
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
      <MetricSection type="weight" label="Weight" format={(m) => `${m.value} ${m.unit}`} />
      <MetricSection type="sleepAsleep" label="Sleep" format={(m) => `${(m.value / 3600).toFixed(1)} h`} />
      <CaloriesSection />
      <MetricSection type="vo2Max" label="VO2max" format={(m) => `${m.value} ${m.unit}`} />
    </section>
  );
}
