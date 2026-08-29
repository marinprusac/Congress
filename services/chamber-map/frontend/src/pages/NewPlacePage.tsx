import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ExhibitTextarea,
  ExhibitActionBar,
  ExhibitLinksLayout,
  navigateToExhibit,
  getChamberIcon,
  useShellHosted,
  resolveChamberPath,
  flushDraftConnections,
  FormErrorMessage,
} from "@congress/congress-ui";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";
import { createPlace, quickCreatePlaceExhibit } from "@/lib/api";
import { PlacePicker } from "@/components/PlacePicker";

const inputClass =
  "w-full border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent";

function fieldLabel(children: React.ReactNode) {
  return <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">{children}</label>;
}

// Mirrors PlaceViewPage's editing state exactly (name input, radius/picker
// fields, ExhibitTextarea, ExhibitLinksLayout with a live Connections panel)
// rather than a plain form. Connections picked here are staged
// (ExhibitLinksLayout's `exhibitId={null}` mode) and only actually written
// once the create mutation below hands them a real id to attach to.
export function NewPlacePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [name, setName] = useState(searchParams.get("name") ?? "");
  const [body, setBody] = useState("");
  const [radiusMeters, setRadiusMeters] = useState(100);
  const [coords, setCoords] = useState({ latitude: 0, longitude: 0 });
  const [draftConnections, setDraftConnections] = useState<CapitolExhibitSearchResult[]>([]);

  // Best-effort prefill so the picker doesn't open centered on the ocean -
  // the owner can still drag/click to adjust either way.
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => {},
      { timeout: 5000 }
    );
  }, []);

  const mutation = useMutation({
    mutationFn: async () => {
      const created = await createPlace({ name, body, radiusMeters, ...coords });
      await flushDraftConnections(`place-${created.id}`, draftConnections);
      return created;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["places"] });
      navigate(resolveChamberPath(`/p/${created.id}`, "map", shellHosted));
    },
  });

  async function onCreateExhibit(title: string) {
    const result = await quickCreatePlaceExhibit(title);
    queryClient.invalidateQueries({ queryKey: ["places"] });
    return result;
  }

  return (
    <article>
      <div className="mb-6 border-b border-dust pb-4">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="w-full font-display text-3xl text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>

      {mutation.isError && <FormErrorMessage>{(mutation.error as Error).message}</FormErrorMessage>}

      <div className="mb-6 flex flex-col gap-4">
        <div className="sm:w-1/2">
          {fieldLabel("Geofence radius (meters)")}
          <input
            type="number"
            min={10}
            value={radiusMeters}
            onChange={(e) => setRadiusMeters(Number(e.target.value))}
            className={inputClass}
          />
        </div>

        <div>
          {fieldLabel("Location (click or drag the pin to adjust)")}
          <PlacePicker latitude={coords.latitude} longitude={coords.longitude} radiusMeters={radiusMeters} onChange={setCoords} />
        </div>
      </div>

      <ExhibitLinksLayout
        exhibitId={null}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("map", r, navigate, shellHosted)}
        editable
        onCreateReference={onCreateExhibit}
        draftConnections={draftConnections}
        onDraftConnectionsChange={setDraftConnections}
        actions={
          <ExhibitActionBar>
            <button
              onClick={() => name.trim() && mutation.mutate()}
              disabled={!name.trim() || mutation.isPending}
              className="tap-target text-accent hover:underline disabled:opacity-50"
            >
              {mutation.isPending ? "Creating —" : "Create"}
            </button>
            <button
              onClick={() => navigate(resolveChamberPath("/places", "map", shellHosted))}
              className="tap-target text-slate hover:underline"
            >
              Cancel
            </button>
          </ExhibitActionBar>
        }
      >
        <ExhibitTextarea
          value={body}
          onChange={setBody}
          rows={8}
          placeholder="Notes (optional), [[ to reference an Exhibit"
          className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          renderIcon={(chamber) => getChamberIcon(chamber)}
          onCreate={onCreateExhibit}
        />
      </ExhibitLinksLayout>
    </article>
  );
}
