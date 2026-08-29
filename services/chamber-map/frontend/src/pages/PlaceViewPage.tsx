import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExhibitFieldEditor,
  ExhibitActionBar,
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

  // Loads exactly once per place, not on every background refetch - the
  // body field is now always live (see below), so a resync gated on
  // `!editing` (editing only ever toggles the name/radius/location fields)
  // would stomp in-progress body edits made while `editing` is false.
  const initializedPlaceIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (placeQuery.data && initializedPlaceIdRef.current !== placeQuery.data.id) {
      const p = placeQuery.data;
      setDraft({ name: p.name, body: p.body, latitude: p.latitude, longitude: p.longitude, radiusMeters: p.radiusMeters });
      initializedPlaceIdRef.current = p.id;
    }
  }, [placeQuery.data]);

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

  function cancel() {
    setEditing(false);
    setDraft({ name: place.name, body: place.body, latitude: place.latitude, longitude: place.longitude, radiusMeters: place.radiusMeters });
  }

  const bodyDirty = (draft.body ?? "") !== place.body;
  const showSaveControls = editing || bodyDirty;

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
          </h2>
        )}
      </div>

      {updateMutation.isError && <p className="mb-4 font-mono text-sm text-alert">{(updateMutation.error as Error).message}</p>}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            {showSaveControls ? (
              <>
                <button onClick={save} className="tap-target text-accent hover:underline">
                  Save
                </button>
                <button onClick={cancel} className="tap-target text-slate hover:underline">
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
        <ExhibitFieldEditor
          value={draft.body ?? ""}
          onChange={(value) => setDraft((d) => ({ ...d, body: value }))}
          minRows={8}
          placeholder="— No notes —"
          className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink focus-within:outline-none"
          renderIcon={(chamber) => getChamberIcon(chamber)}
          onNavigate={(r) => navigateToExhibit("map", r, navigate, shellHosted)}
          onCreate={onCreateExhibit}
        />
      </ExhibitLinksLayout>

      <ConfirmSheet
        open={confirmingDelete}
        title="Delete place"
        message={`Delete "${place.name}"? Past visits keep their history but lose this place's name.`}
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
