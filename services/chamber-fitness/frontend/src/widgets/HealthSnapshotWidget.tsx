import { useQuery } from "@tanstack/react-query";
import { WidgetPreviewShell } from "@congress/congress-ui";
import { fetchHealthLatest } from "@/lib/api";

export function HealthSnapshotWidget() {
  const { data, isLoading, isError } = useQuery({ queryKey: ["health", "latest"], queryFn: fetchHealthLatest });

  const totalCalories =
    data?.activeEnergy && data?.restingEnergy ? data.activeEnergy.value + data.restingEnergy.value : null;

  return (
    <WidgetPreviewShell
      label="Health"
      addHref="/metrics"
      addLabel="View all"
      ownChamber="fitness"
      isLoading={isLoading}
      isError={isError}
      errorLabel="Fitness unavailable."
      isEmpty={!isLoading && !isError && !data?.weight && !data?.sleepAsleep && totalCalories == null && !data?.vo2Max}
      emptyLabel="— No health data synced yet —"
    >
      <dl className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-xs text-ink">
        {data?.weight && (
          <>
            <dt className="text-dust">Weight</dt>
            <dd>
              {data.weight.value} {data.weight.unit}
            </dd>
          </>
        )}
        {data?.sleepAsleep && (
          <>
            <dt className="text-dust">Sleep</dt>
            <dd>{(data.sleepAsleep.value / 3600).toFixed(1)} h</dd>
          </>
        )}
        {totalCalories != null && (
          <>
            <dt className="text-dust">Calories</dt>
            <dd>{Math.round(totalCalories)} kcal</dd>
          </>
        )}
        {data?.vo2Max && (
          <>
            <dt className="text-dust">VO2max</dt>
            <dd>
              {data.vo2Max.value} {data.vo2Max.unit}
            </dd>
          </>
        )}
      </dl>
    </WidgetPreviewShell>
  );
}
