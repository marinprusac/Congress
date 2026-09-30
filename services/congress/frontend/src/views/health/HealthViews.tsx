import { useQuery } from "@tanstack/react-query";
import { ChamberHeader, ChamberMark, useAppliedTheme, useBackNavigation, ViewCard } from "@congress/congress-ui";
import { fetchHealthLatest, fetchHealthSeries, type HealthMetric, type HealthMetricType } from "@/lib/fitnessApi";
import { mergeCalories } from "./format";

// Apple Health from the health connector: a card for the feed and the full
// /fitness/health view (latest values, then recent samples per metric).

const kg = (m: HealthMetric) => `${m.value} ${m.unit}`;
const hours = (m: HealthMetric) => `${(m.value / 3600).toFixed(1)} h`;

export function HealthCard() {
  const { data, isLoading, isError } = useQuery({ queryKey: ["health", "latest"], queryFn: fetchHealthLatest });
  const calories = data?.activeEnergy && data?.restingEnergy ? data.activeEnergy.value + data.restingEnergy.value : null;
  const rows: [string, string][] = [
    ...(data?.weight ? [["Weight", kg(data.weight)] as [string, string]] : []),
    ...(data?.sleepAsleep ? [["Sleep", hours(data.sleepAsleep)] as [string, string]] : []),
    ...(calories != null ? [["Calories", `${Math.round(calories)} kcal`] as [string, string]] : []),
    ...(data?.vo2Max ? [["VO2max", kg(data.vo2Max)] as [string, string]] : []),
  ];
  return (
    <ViewCard isLoading={isLoading} isError={isError} errorLabel="Health unavailable." isEmpty={!isLoading && !isError && rows.length === 0} emptyLabel="— No health data synced yet —">
      <dl className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-xs text-ink">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-dust">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </ViewCard>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mb-8 border-t border-dust pt-4">
      <p className="mb-3 font-mono text-xs uppercase tracking-wide text-dust">{label}</p>
      {children}
    </section>
  );
}

function Rows({ rows, isLoading, isError }: { rows: { key: string; when: string; value: string; note?: string }[]; isLoading: boolean; isError: boolean }) {
  if (isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (isError) return <p className="font-mono text-sm text-alert">Unavailable.</p>;
  if (rows.length === 0) return <p className="font-mono text-sm text-dust">— No data synced yet —</p>;
  return (
    <>
      <p className="mb-3 font-display text-2xl text-ink">{rows[0]!.value}</p>
      <ul className="divide-y divide-dust/50">
        {rows.map((r) => (
          <li key={r.key} className="flex items-baseline justify-between gap-3 py-2 font-mono text-sm">
            <span className="min-w-0 truncate text-slate">{r.when}</span>
            <span className="shrink-0 text-right text-ink">
              {r.value}
              {r.note && <span className="block text-xs text-dust">{r.note}</span>}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Metric({ type, label, format }: { type: HealthMetricType; label: string; format: (m: HealthMetric) => string }) {
  const q = useQuery({ queryKey: ["health", "series", type], queryFn: () => fetchHealthSeries(type) });
  const rows = (q.data ?? []).map((m) => ({ key: String(m.id), when: new Date(m.startDate).toLocaleString(), value: format(m) }));
  return (
    <Section label={label}>
      <Rows rows={rows} isLoading={q.isLoading} isError={q.isError} />
    </Section>
  );
}

function Calories() {
  const active = useQuery({ queryKey: ["health", "series", "activeEnergy"], queryFn: () => fetchHealthSeries("activeEnergy") });
  const resting = useQuery({ queryKey: ["health", "series", "restingEnergy"], queryFn: () => fetchHealthSeries("restingEnergy") });
  const rows = mergeCalories(active.data ?? [], resting.data ?? []).map((r) => ({
    key: r.startDate,
    when: new Date(r.startDate).toLocaleDateString(),
    value: `${Math.round(r.active + r.resting)} kcal`,
    note: `${Math.round(r.active)} active + ${Math.round(r.resting)} resting`,
  }));
  return (
    <Section label="Calories">
      <Rows rows={rows} isLoading={active.isLoading || resting.isLoading} isError={active.isError || resting.isError} />
    </Section>
  );
}

export function HealthPage() {
  useAppliedTheme();
  const back = useBackNavigation();
  return (
    <div className="chamber-shell">
      <ChamberHeader icon={<ChamberMark name="fitness" className="h-6 w-6 text-ink" />} title="Health" titleHref="" onBack={back} />
      <main className="chamber-main">
        <Metric type="weight" label="Weight" format={kg} />
        <Metric type="sleepAsleep" label="Sleep" format={hours} />
        <Calories />
        <Metric type="vo2Max" label="VO2max" format={kg} />
      </main>
    </div>
  );
}
