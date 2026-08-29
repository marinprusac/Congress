import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, FormLabel, FormTextInput, showToast } from "@congress/congress-ui";
import { fetchVisits, fetchPlaces, classifyVisit } from "@/lib/api";
import { PlacePicker } from "@/components/PlacePicker";
import { formatDuration } from "@/lib/formatDuration";
import type { PlaceSummary, Visit } from "../../../src/types";

function PendingVisitCard({ visit, places }: { visit: Visit; places: PlaceSummary[] }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [radiusMeters, setRadiusMeters] = useState(100);
  const [adhocLabel, setAdhocLabel] = useState("");
  const [existingPlaceId, setExistingPlaceId] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["visits"] });

  const saveMutation = useMutation({
    mutationFn: () => classifyVisit(visit.id, { action: "save_place", name, radiusMeters, body: "" }),
    onSuccess: () => {
      invalidate();
      showToast(`Saved "${name}"`);
    },
  });

  const assignMutation = useMutation({
    mutationFn: () => classifyVisit(visit.id, { action: "assign_place", placeId: Number(existingPlaceId) }),
    onSuccess: () => {
      invalidate();
      const placeName = places.find((p) => p.id === Number(existingPlaceId))?.name ?? "place";
      showToast(`Assigned to "${placeName}"`);
    },
  });

  const adhocMutation = useMutation({
    mutationFn: () => classifyVisit(visit.id, { action: "adhoc_label", label: adhocLabel }),
    onSuccess: () => {
      invalidate();
      showToast("Labeled");
    },
  });

  const ignoreMutation = useMutation({
    mutationFn: () => classifyVisit(visit.id, { action: "ignore" }),
    onSuccess: () => {
      invalidate();
      showToast("Ignored");
    },
  });

  const pending = saveMutation.isPending || assignMutation.isPending || adhocMutation.isPending || ignoreMutation.isPending;

  return (
    <div className="mb-8 border border-dust p-4">
      <p className="mb-3 font-mono text-xs text-dust">
        Arrived {new Date(visit.arrivedAt).toLocaleString()}
        {visit.durationMinutes !== null ? ` — dwelling ${formatDuration(visit.durationMinutes)}` : ""}
      </p>

      {visit.latitude !== null && visit.longitude !== null && (
        <div className="mb-4">
          <PlacePicker latitude={visit.latitude} longitude={visit.longitude} radiusMeters={radiusMeters} onChange={() => {}} readOnly height={180} />
        </div>
      )}

      {places.length > 0 && (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start">
          <select
            value={existingPlaceId}
            onChange={(e) => setExistingPlaceId(e.target.value)}
            className="mb-0 w-full min-w-0 flex-1 border border-dust bg-parchment px-3 py-2 font-display text-xl text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          >
            <option value="">This is already one of my places —</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            disabled={!existingPlaceId || pending}
            onClick={() => assignMutation.mutate()}
            className="shrink-0 border border-accent px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-accent hover:bg-accent hover:text-parchment disabled:opacity-50"
          >
            Use this place
          </button>
        </div>
      )}

      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormTextInput placeholder="Place name" value={name} onChange={(e) => setName(e.target.value)} />
        <FormTextInput type="number" min={10} placeholder="Radius (m)" value={radiusMeters} onChange={(e) => setRadiusMeters(Number(e.target.value))} />
      </div>
      <button
        disabled={!name.trim() || pending}
        onClick={() => saveMutation.mutate()}
        className="mb-4 border border-accent px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-accent hover:bg-accent hover:text-parchment disabled:opacity-50"
      >
        Save as new place
      </button>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <FormTextInput placeholder='One-off label (e.g. "errand")' value={adhocLabel} onChange={(e) => setAdhocLabel(e.target.value)} />
        </div>
        <button
          disabled={!adhocLabel.trim() || pending}
          onClick={() => adhocMutation.mutate()}
          className="shrink-0 border border-dust px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-slate hover:border-accent hover:text-accent disabled:opacity-50"
        >
          Label just this once
        </button>
      </div>

      <button disabled={pending} onClick={() => ignoreMutation.mutate()} className="tap-target font-mono text-xs uppercase tracking-wide text-alert hover:underline">
        Ignore
      </button>
    </div>
  );
}

export function PendingVisitsPage() {
  const query = useQuery({ queryKey: ["visits", "pending"], queryFn: () => fetchVisits({ status: "pending" }) });
  const placesQuery = useQuery({ queryKey: ["places"], queryFn: fetchPlaces });
  const places = placesQuery.data ?? [];

  return (
    <section>
      <PageHeader title="Pending" />
      {query.isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
      {query.isError && <p className="font-mono text-sm text-alert">Pending visits unavailable.</p>}
      {query.data && query.data.length === 0 && <p className="font-mono text-sm text-dust">— Nothing awaiting classification —</p>}
      {query.data?.map((visit) => (
        <PendingVisitCard key={visit.id} visit={visit} places={places} />
      ))}
    </section>
  );
}
