import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExhibitTextarea,
  ExhibitActionBar,
  ExhibitAnnotatedText,
  ExhibitLinksLayout,
  navigateToExhibit,
  getChamberIcon,
  useShellHosted,
  resolveChamberPath,
  ConfirmSheet,
  showToast,
} from "@congress/congress-ui";
import { fetchPlace, updatePlace, deletePlace, quickCreatePlaceExhibit } from "@/lib/api";
import { PlacePicker } from "@/components/PlacePicker";
import type { UpdatePlaceRequest } from "../../../src/types";

const inputClass =
  "w-full border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent";

function fieldLabel(children: ReactNode) {
  return <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">{children}</label>;
}

export function PlaceViewPage() {
  const { id } = useParams<{ id: string }>();
  const placeId = Number(id);
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState<UpdatePlaceRequest>({});

  const placeQuery = useQuery({
    queryKey: ["place", placeId],
    queryFn: () => fetchPlace(placeId),
    enabled: Number.isInteger(placeId),
  });

  const updateMutation = useMutation({
    mutationFn: (input: UpdatePlaceRequest) => updatePlace(placeId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(["place", placeId], updated);
      queryClient.invalidateQueries({ queryKey: ["places"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deletePlace(placeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["places"] });
      navigate(resolveChamberPath("/places", "map", shellHosted));
      showToast("Place deleted");
    },
    onError: () => showToast("Failed to delete place.", "error"),
  });

  useEffect(() => {
    if (placeQuery.data && !editing) {
      const p = placeQuery.data;
      setDraft({ name: p.name, body: p.body, category: p.category, latitude: p.latitude, longitude: p.longitude, radiusMeters: p.radiusMeters });
    }
  }, [placeQuery.data, editing]);

  if (!Number.isInteger(placeId)) return <p className="font-mono text-sm text-alert">Invalid place id.</p>;
  if (placeQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (placeQuery.isError || !placeQuery.data) return <p className="font-mono text-sm text-alert">Place not found.</p>;

  const place = placeQuery.data;

  async function onCreateExhibit(title: string) {
    const result = await quickCreatePlaceExhibit(title);
    queryClient.invalidateQueries({ queryKey: ["places"] });
    return result;
  }

  function save() {
    updateMutation.mutate(draft, { onSuccess: () => setEditing(false) });
  }

  return (
    <article>
      <div className="mb-6 border-b border-dust pb-4">
        {editing ? (
          <input
            value={draft.name ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            className="w-full font-display text-3xl text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          />
        ) : (
          <h2 className="flex min-w-0 items-center gap-3 font-display text-3xl text-ink">
            <span>{place.name}</span>
            <span className="font-mono text-sm text-dust">{place.category}</span>
          </h2>
        )}
      </div>

      {updateMutation.isError && <p className="mb-4 font-mono text-sm text-alert">{(updateMutation.error as Error).message}</p>}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          {fieldLabel("Category")}
          {editing ? (
            <input
              value={draft.category ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
              placeholder="home, work, gym, ignored, ..."
              className={inputClass}
            />
          ) : (
            <p className="font-mono text-sm text-ink">{place.category}</p>
          )}
        </div>

        <div>
          {fieldLabel("Geofence radius (meters)")}
          {editing ? (
            <input
              type="number"
              min={10}
              value={draft.radiusMeters ?? place.radiusMeters}
              onChange={(e) => setDraft((d) => ({ ...d, radiusMeters: Number(e.target.value) }))}
              className={inputClass}
            />
          ) : (
            <p className="font-mono text-sm text-ink">{place.radiusMeters} m</p>
          )}
        </div>

        <div className="sm:col-span-2">
          {fieldLabel("Location")}
          <PlacePicker
            latitude={draft.latitude ?? place.latitude}
            longitude={draft.longitude ?? place.longitude}
            radiusMeters={draft.radiusMeters ?? place.radiusMeters}
            onChange={(next) => setDraft((d) => ({ ...d, ...next }))}
            readOnly={!editing}
          />
        </div>
      </div>

      <ExhibitLinksLayout
        exhibitId={`place-${placeId}`}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("map", r, navigate, shellHosted)}
        editable
        onCreateReference={onCreateExhibit}
        actions={
          <ExhibitActionBar>
            {editing ? (
              <>
                <button onClick={save} className="tap-target text-accent hover:underline">
                  Save
                </button>
                <button onClick={() => setEditing(false)} className="tap-target text-slate hover:underline">
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setEditing(true)} className="tap-target text-accent hover:underline">
                  Edit
                </button>
                <button onClick={() => setConfirmingDelete(true)} className="tap-target text-alert hover:underline">
                  Delete
                </button>
              </>
            )}
          </ExhibitActionBar>
        }
      >
        {editing ? (
          <ExhibitTextarea
            value={draft.body ?? ""}
            onChange={(value) => setDraft((d) => ({ ...d, body: value }))}
            rows={8}
            className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
            renderIcon={(chamber) => getChamberIcon(chamber)}
            onCreate={onCreateExhibit}
          />
        ) : place.body ? (
          <ExhibitAnnotatedText
            text={place.body}
            renderIcon={(chamber) => getChamberIcon(chamber)}
            onNavigate={(r) => navigateToExhibit("map", r, navigate, shellHosted)}
            className="whitespace-pre-wrap text-base text-ink"
          />
        ) : (
          <p className="whitespace-pre-wrap text-base text-dust">— No notes —</p>
        )}
      </ExhibitLinksLayout>

      <ConfirmSheet
        open={confirmingDelete}
        title="Delete place"
        message={`Delete "${place.name}"? Past visits keep their history but lose this place's name/category.`}
        confirmLabel="Delete"
        onConfirm={() => {
          setConfirmingDelete(false);
          deleteMutation.mutate();
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </article>
  );
}
