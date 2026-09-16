import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExhibitFieldEditor,
  ExhibitActionBar,
  ExhibitLinksLayout,
  navigateToExhibit,
  getChamberIcon,
  useShellHosted,
  resolveChamberPath,
  flushDraftConnections,
  ConfirmSheet,
  showToast,
  useAutosave,
  useDraftCreate,
  resolveEditorIdentity,
  FormErrorMessage,
  FormLabel,
} from "@congress/congress-ui";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";
import { createPlace, fetchPlace, updatePlace, deletePlace, quickCreatePlaceExhibit } from "@/lib/api";
import { PlacePicker } from "@/components/PlacePicker";
import type { UpdatePlaceRequest } from "../../../src/types";

const draftInputClass =
  "w-full border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent";

function parsePlaceId(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

// Handles both "create" (route `/places/new`, no `:id`) and "edit" (route
// `/p/:id`) as one mounted component - see chamber-notes' NoteEditorPage,
// which this mirrors, for the full reasoning behind merging the two.
export function PlaceEditorPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();

  const [placeId, setPlaceId] = useState<number | null>(() => parsePlaceId(idParam));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState<UpdatePlaceRequest>({
    name: searchParams.get("name") ?? "",
    body: "",
    radiusMeters: 100,
    latitude: 0,
    longitude: 0,
  });
  const [draftConnections, setDraftConnections] = useState<CapitolExhibitSearchResult[]>([]);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // Best-effort prefill so a brand new place's picker doesn't open centered
  // on the ocean - the owner can still drag/click to adjust either way.
  // Keyed on `placeId` rather than mount alone, so returning to the draft
  // route later in the same session (having since created/viewed a real
  // place, no full remount to trigger this the old way) still gets a fresh
  // fix instead of silently reusing whatever the first draft happened to
  // have - or nothing at all.
  useEffect(() => {
    if (placeId !== null || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setDraft((d) => ({ ...d, latitude: pos.coords.latitude, longitude: pos.coords.longitude })),
      () => {},
      { timeout: 5000 }
    );
  }, [placeId]);

  const placeQuery = useQuery({
    queryKey: ["place", placeId],
    queryFn: () => fetchPlace(placeId as number),
    enabled: placeId !== null,
  });

  const createMutation = useMutation({
    mutationFn: async (d: UpdatePlaceRequest) => {
      const created = await createPlace({
        name: d.name ?? "",
        body: d.body ?? "",
        radiusMeters: d.radiusMeters ?? 100,
        latitude: d.latitude ?? 0,
        longitude: d.longitude ?? 0,
      });
      await flushDraftConnections(`place-${created.id}`, draftConnections);
      return created;
    },
    onSuccess: (created, d) => {
      queryClient.setQueryData(["place", created.id], created);
      queryClient.invalidateQueries({ queryKey: ["places"] });
      if (placeId !== null) return;
      initializedPlaceIdRef.current = created.id;
      markSaved(d);
      setPlaceId(created.id);
      navigate(resolveChamberPath(`/p/${created.id}`, "map", shellHosted), { replace: true });
    },
    onError: () => {
      draftCreate.reset();
      showToast("Failed to create place.", "error");
    },
  });

  // Fires on the name field's blur (see the input's onBlur below) rather
  // than a content-change debounce - see useDraftCreate's own comment.
  const draftCreate = useDraftCreate({
    value: draft,
    canCreate: (v) => placeId === null && (v.name ?? "").trim().length > 0,
    onCreate: (d) => createMutation.mutate(d),
  });

  // A navigation between two different ids, or back to the draft/"new"
  // route, reuses this same mounted component - see resolveEditorIdentity's
  // own comment.
  useEffect(() => {
    const fromUrl = parsePlaceId(idParam);
    if (resolveEditorIdentity(fromUrl, placeId) === "keep") return;
    draftCreate.attempt();
    setPlaceId(fromUrl);
    // A fresh draft gets concrete defaults (nothing else will fill them in);
    // navigating to a different *existing* place instead resets to `{}` so
    // the `?? place?.X` fallbacks below keep showing sensible values (0,0
    // would otherwise paint the picker centered on the ocean for one frame
    // before the load effect below catches up).
    setDraft(fromUrl === null ? { name: "", body: "", radiusMeters: 100, latitude: 0, longitude: 0 } : {});
    setDraftConnections([]);
    initializedPlaceIdRef.current = null;
    draftCreate.reset();
    if (fromUrl === null) nameInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idParam, placeId]);

  const updateMutation = useMutation({
    mutationFn: (input: UpdatePlaceRequest) => updatePlace(placeId as number, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(["place", placeId], updated);
      queryClient.invalidateQueries({ queryKey: ["places"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deletePlace(placeId as number),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["places"] });
      navigate(resolveChamberPath("/places", "map", shellHosted));
      showToast("Place deleted");
    },
    onError: () => showToast("Failed to delete place.", "error"),
  });

  // Loads exactly once per place, not on every background refetch -
  // otherwise a resync would stomp in-progress edits. Also covers the
  // just-created place: its query is pre-seeded via setQueryData above, so
  // this effect's `markSaved` runs immediately without feeding a stale/
  // empty server value back into the editor.
  const initializedPlaceIdRef = useRef<number | null>(null);
  const { markSaved } = useAutosave({
    value: draft,
    enabled: placeId !== null && initializedPlaceIdRef.current === placeId,
    onSave: (d) => updateMutation.mutate(d),
  });
  useEffect(() => {
    if (placeQuery.data && initializedPlaceIdRef.current !== placeQuery.data.id) {
      const p = placeQuery.data;
      const loaded: UpdatePlaceRequest = {
        name: p.name,
        body: p.body,
        latitude: p.latitude,
        longitude: p.longitude,
        radiusMeters: p.radiusMeters,
      };
      setDraft(loaded);
      markSaved(loaded);
      initializedPlaceIdRef.current = p.id;
    }
  }, [placeQuery.data, markSaved]);

  const isDraft = placeId === null;
  if (!isDraft && placeQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (!isDraft && (placeQuery.isError || !placeQuery.data))
    return <p className="font-mono text-sm text-alert">Place not found.</p>;

  const place = isDraft ? null : placeQuery.data ?? null;

  async function onCreateExhibit(title: string) {
    const result = await quickCreatePlaceExhibit(title);
    queryClient.invalidateQueries({ queryKey: ["places"] });
    return result;
  }

  return (
    <article>
      <div className="mb-6 border-b border-dust pb-4">
        <input
          ref={nameInputRef}
          autoFocus={isDraft}
          value={draft.name ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          onBlur={() => draftCreate.attempt()}
          placeholder={isDraft ? "Name" : "Untitled"}
          className="w-full font-display text-3xl text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>

      {createMutation.isError && <FormErrorMessage>{(createMutation.error as Error).message}</FormErrorMessage>}
      {updateMutation.isError && (
        <p className="mb-4 font-mono text-sm text-alert">{(updateMutation.error as Error).message}</p>
      )}

      <div className="mb-6 flex flex-col gap-4 sm:grid sm:grid-cols-2">
        <div className="sm:w-1/2">
          <FormLabel>Geofence radius (meters)</FormLabel>
          <input
            type="number"
            min={10}
            value={draft.radiusMeters ?? place?.radiusMeters ?? 100}
            onChange={(e) => setDraft((d) => ({ ...d, radiusMeters: Number(e.target.value) }))}
            className={isDraft ? draftInputClass : "field-plain font-mono text-sm"}
          />
        </div>

        <div className="sm:col-span-2">
          <FormLabel>{isDraft ? "Location (click or drag the pin to adjust)" : "Location"}</FormLabel>
          <PlacePicker
            latitude={draft.latitude ?? place?.latitude ?? 0}
            longitude={draft.longitude ?? place?.longitude ?? 0}
            radiusMeters={draft.radiusMeters ?? place?.radiusMeters ?? 100}
            onChange={(next) => setDraft((d) => ({ ...d, ...next }))}
          />
        </div>
      </div>

      <ExhibitLinksLayout
        exhibitId={isDraft ? null : `place-${placeId}`}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("map", r, navigate, shellHosted)}
        editable
        onCreateReference={onCreateExhibit}
        draftConnections={draftConnections}
        onDraftConnectionsChange={setDraftConnections}
        actions={
          <ExhibitActionBar>
            {isDraft ? (
              <button
                onClick={() => navigate(resolveChamberPath("/places", "map", shellHosted))}
                className="tap-target text-slate hover:underline"
              >
                Cancel
              </button>
            ) : (
              <button onClick={() => setConfirmingDelete(true)} className="tap-target text-alert hover:underline">
                Delete
              </button>
            )}
          </ExhibitActionBar>
        }
      >
        <ExhibitFieldEditor
          value={draft.body ?? ""}
          onChange={(value) => setDraft((d) => ({ ...d, body: value }))}
          minRows={isDraft ? 8 : 3}
          placeholder={isDraft ? "Notes (optional), @ to reference an Exhibit" : "— No notes —"}
          className="w-full bg-parchment p-3 font-body text-base text-ink focus-within:outline-none"
          renderIcon={(chamber) => getChamberIcon(chamber)}
          onNavigate={(r) => navigateToExhibit("map", r, navigate, shellHosted)}
          onCreate={onCreateExhibit}
        />
      </ExhibitLinksLayout>

      {!isDraft && (
        <ConfirmSheet
          open={confirmingDelete}
          title="Delete place"
          message={`Delete "${place?.name}"? Past visits keep their history but lose this place's name.`}
          confirmLabel="Delete"
          onConfirm={() => {
            setConfirmingDelete(false);
            deleteMutation.mutate();
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </article>
  );
}
