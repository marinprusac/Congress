import type { EventDelivery } from "@congress/shared-types";
import { getSettings } from "./settings.js";
import { bufferEvent } from "./pendingEvents.js";

// Handed to mountEventReceiveRoute (@congress/chamber-kit). This Chamber
// subscribes to every event type (subscriptions.ts) and buffers every
// delivery toward whichever scheduled directive next runs (checkup.ts
// drains the buffer when a directive's own timer fires) - there is no
// immediate-run fast path any more (that used to key off an event's
// payload.priority, which no longer exists).
export async function handleReceivedEvent(event: EventDelivery): Promise<void> {
  const settings = await getSettings();
  if (settings.paused) return;

  bufferEvent(event);
}
