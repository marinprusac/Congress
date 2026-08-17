import { fetchRegistry } from "@congress/congress-ui";
import type { ManifestEvent } from "@congress/shared-types";

export interface EventCatalogEntry extends ManifestEvent {
  chamber: string;
  chamberDisplayName: string;
}

// The live, declared catalog of event types any registered Chamber may
// publish (manifest.events - see shared-types/manifest.ts) - purely for the
// log rule editor's TriggerEventPicker to offer/validate against, not the
// actual event log itself (see eventPoller.ts on this Chamber's own backend
// for that). Nothing here is hardcoded to a specific Chamber name.
export async function fetchEventCatalog(): Promise<EventCatalogEntry[]> {
  const chambers = await fetchRegistry();
  return chambers.flatMap((chamber) =>
    chamber.events.map((event) => ({ ...event, chamber: chamber.name, chamberDisplayName: chamber.displayName }))
  );
}
