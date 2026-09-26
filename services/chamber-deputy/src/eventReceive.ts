import type { EventDelivery, EventLogEntry } from "@congress/shared-types";
import { bufferEvent } from "./pendingEvents.js";
import { listEventTriggeredDirectives, markDirectiveRunNow } from "./directives.js";
import { isAiPaused, runDirective } from "./engine.js";

// Handed to mountEventReceiveRoute (@congress/chamber-kit). This Chamber
// subscribes to every event type (subscriptions.ts). Every delivery is
// buffered toward whichever "interval"/"daily"/"weekly" directive next runs
// (checkup.ts drains the buffer when one comes due) - and any enabled
// "event"-scheduled directive whose triggerEventType matches this delivery
// fires immediately right here, bypassing the periodic timer entirely.
// While Congress's AI is paused, events are ignored outright, same as before
// the engine moved into Congress.
export async function handleReceivedEvent(event: EventDelivery): Promise<void> {
  if (await isAiPaused()) return;

  bufferEvent(event);

  const triggered = await listEventTriggeredDirectives(event.type);
  if (triggered.length === 0) return;

  const logEntry: EventLogEntry = { id: 0, chamber: event.chamber, type: event.type, payload: event.payload, occurredAt: event.occurredAt };
  for (const directive of triggered) {
    // Stamped now, before the run executes, so a slow run can't let a second
    // matching event re-fire the same directive concurrently.
    await markDirectiveRunNow(directive.id);
    void runDirective({ trigger: "event", events: [logEntry], directive }).catch((err) =>
      console.warn(`Deputy event-triggered run for directive ${directive.id} failed: ${(err as Error).message}`)
    );
  }
}
