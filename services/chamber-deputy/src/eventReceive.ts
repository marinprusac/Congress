import type { EventDelivery, EventLogEntry } from "@congress/shared-types";
import { getSettings } from "./settings.js";
import { bufferEvent } from "./pendingEvents.js";
import { listEventTriggeredDirectives, markDirectiveRunNow } from "./directives.js";
import { enqueue } from "./jobQueue.js";
import { runDeputy } from "./engine.js";
import { withRunningDirective } from "./runningState.js";

// Handed to mountEventReceiveRoute (@congress/chamber-kit). This Chamber
// subscribes to every event type (subscriptions.ts). Every delivery is
// always buffered toward whichever "interval"/"daily"/"weekly" directive
// next runs (checkup.ts drains the buffer when one comes due) - and, in
// addition, any enabled "event"-scheduled directive whose own
// triggerEventType matches this delivery fires immediately right here,
// bypassing the periodic timer entirely. This is the "urgent fast path"
// the original plan doc described, rebuilt as an explicit per-directive
// subscription now that the payload.priority convention it used to key off
// no longer exists.
export async function handleReceivedEvent(event: EventDelivery): Promise<void> {
  const settings = await getSettings();
  if (settings.paused) return;

  bufferEvent(event);

  const triggered = await listEventTriggeredDirectives(event.type);
  if (triggered.length === 0) return;

  const logEntry: EventLogEntry = { id: 0, chamber: event.chamber, type: event.type, payload: event.payload, occurredAt: event.occurredAt };
  for (const directive of triggered) {
    // Stamped now, before the run actually executes, same reasoning as
    // checkup.ts's own tick() - a slow `claude` invocation can't cause a
    // second matching event to re-fire the same directive concurrently.
    await markDirectiveRunNow(directive.id);
    void enqueue(() => withRunningDirective(directive.id, () => runDeputy({ trigger: "event", events: [logEntry], directive }))).catch((err) =>
      console.warn(`Deputy event-triggered run for directive ${directive.id} failed: ${(err as Error).message}`)
    );
  }
}
