import type { EventDelivery } from "@congress/shared-types";
import { getSettings } from "./settings.js";
import { enqueue } from "./jobQueue.js";
import { runDeputy } from "./engine.js";
import { bufferEvent } from "./pendingEvents.js";

function isUrgent(event: EventDelivery): boolean {
  return event.payload?.priority === "urgent";
}

// Handed to mountEventReceiveRoute (@congress/chamber-kit). This Chamber
// subscribes to every event type (subscriptions.ts), so every delivery is
// buffered toward the next periodic checkup (checkup.ts); one marked
// urgent additionally preempts that checkup with its own immediate run
// right now - the same two-track behavior the old poll loop's
// lastUrgentEventId/lastCheckupEventId split gave it, just driven by a push
// instead of a 20s scan.
export async function handleReceivedEvent(event: EventDelivery): Promise<void> {
  const settings = await getSettings();
  if (settings.paused) return;

  const id = bufferEvent(event);

  if (isUrgent(event)) {
    void enqueue(() =>
      runDeputy({
        trigger: "urgent",
        events: [{ id, chamber: event.chamber, type: event.type, payload: event.payload, occurredAt: event.occurredAt }],
      })
    ).catch((err) => console.warn(`Deputy urgent run failed: ${(err as Error).message}`));
  }
}
