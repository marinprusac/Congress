import type { EventPublishRequest, ChamberSubscription } from "@congress/shared-types";
import { getChamber } from "./registry.js";
import { listModules } from "./chambers/runtime.js";
import { handleReceivedEvent } from "./eventReceive.js";

// Coarse per-chamber gate: does this Chamber's declared interest list (its
// module's subscriptions()) cover this publish at all. "*" subscribes to
// every type. The Chamber's own onEvent still does the precise matching.
export function subscriptionMatches(subscriptions: ChamberSubscription[], type: string): boolean {
  return subscriptions.some((s) => s.type === "*" || s.type === type);
}

export interface PublishedEvent {
  chamber: string;
  type: string;
  payload: unknown;
  occurredAt: string;
  actor?: string;
}

// In-process observers of every publish (Congress's AI); never throw out.
const publishListeners = new Set<(event: PublishedEvent) => void>();
export function onEventPublished(listener: (event: PublishedEvent) => void): () => void {
  publishListeners.add(listener);
  return () => publishListeners.delete(listener);
}

// Relays a published domain event to every active, subscribed Chamber
// instead of storing it - Congress never inspects `type`/`payload`.
// Fire-and-forget: a Chamber's handler failing never reaches the publisher.
export function publishEvent(req: EventPublishRequest): void {
  const occurredAt = req.occurredAt ?? new Date().toISOString();
  const body = { chamber: req.chamber, type: req.type, payload: req.payload, occurredAt, actor: req.actor };

  for (const listener of publishListeners) {
    try {
      listener(body);
    } catch (err) {
      console.warn(`Event listener failed for ${req.type}: ${(err as Error).message}`);
    }
  }

  // Congress's own log rules (record to history / push a notification) are
  // core now, not a subscribing Chamber - handled in-process for every
  // publish, no registry lookup or HTTP hop. handleReceivedEvent does its
  // own precise per-event-type check, so no coarse subscription gate either.
  handleReceivedEvent(body).catch((err: unknown) => {
    console.warn(`Log rule handling failed for ${req.type}: ${(err as Error).message}`);
  });

  for (const module of listModules()) {
    const name = module.manifest.name;
    if (!module.onEvent || getChamber(name)?.status !== "active") continue;
    if (!subscriptionMatches(module.subscriptions?.() ?? [], req.type)) continue;
    void Promise.resolve()
      .then(() => module.onEvent!(body))
      .catch((err: unknown) => console.warn(`[${name}] event handler failed for ${req.type}: ${(err as Error).message}`));
  }
}
