import { fetchRegistry } from "./registry.js";
import type { ManifestEvent } from "@congress/shared-types";

export interface EventCatalogEntry extends ManifestEvent {
  chamber: string;
  chamberDisplayName: string;
}

// The live, declared catalog of event types any registered Chamber may
// publish (manifest.events - see shared-types/manifest.ts). Used by any
// Chamber's own trigger-event picker (chamber-automation's rule editor,
// chamber-deputy's event-triggered directives) to offer/validate against -
// not the actual event log itself. Nothing here is hardcoded to a specific
// Chamber name.
export async function fetchEventCatalog(): Promise<EventCatalogEntry[]> {
  const chambers = await fetchRegistry();
  return chambers.flatMap((chamber) =>
    chamber.events.map((event) => ({ ...event, chamber: chamber.name, chamberDisplayName: chamber.displayName }))
  );
}
