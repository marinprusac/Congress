import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ExhibitTextarea,
  getChamberIcon,
  useShellHosted,
  resolveChamberPath,
  PageHeader,
  FormLabel,
  FormTextInput,
  FormErrorMessage,
  FormSubmitButton,
} from "@congress/congress-ui";
import { createPlace, quickCreatePlaceExhibit } from "@/lib/api";
import { PlacePicker } from "@/components/PlacePicker";

export function NewPlacePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [name, setName] = useState(searchParams.get("name") ?? "");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("place");
  const [radiusMeters, setRadiusMeters] = useState(100);
  const [coords, setCoords] = useState({ latitude: 0, longitude: 0 });

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
    mutationFn: () => createPlace({ name, body, category, radiusMeters, ...coords }),
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
    <section>
      <PageHeader title="New Place" />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) mutation.mutate();
        }}
      >
        <FormLabel>Name</FormLabel>
        <FormTextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} />

        <FormLabel>Category</FormLabel>
        <FormTextInput value={category} onChange={(e) => setCategory(e.target.value)} placeholder="home, work, gym, ignored, ..." />

        <FormLabel>Geofence radius (meters)</FormLabel>
        <FormTextInput type="number" min={10} value={radiusMeters} onChange={(e) => setRadiusMeters(Number(e.target.value))} />

        <FormLabel>Location (click or drag the pin to adjust)</FormLabel>
        <div className="mb-4">
          <PlacePicker latitude={coords.latitude} longitude={coords.longitude} radiusMeters={radiusMeters} onChange={setCoords} />
        </div>

        <FormLabel>Notes (optional, [[ to reference an Exhibit)</FormLabel>
        <ExhibitTextarea
          value={body}
          onChange={setBody}
          rows={8}
          className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          wrapperClassName="exhibit-field mb-4"
          renderIcon={(chamber) => getChamberIcon(chamber)}
          onCreate={onCreateExhibit}
        />

        {mutation.isError && <FormErrorMessage>{(mutation.error as Error).message}</FormErrorMessage>}

        <FormSubmitButton disabled={!name.trim() || mutation.isPending}>
          {mutation.isPending ? "Creating —" : "Create Place"}
        </FormSubmitButton>
      </form>
    </section>
  );
}
