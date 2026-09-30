import type { EventPublishRequest } from "@congress/shared-types";
import { handleReceivedEvent } from "./eventReceive.js";

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

// Hands a published domain event to the AI's observers and Congress's own log rules.
// Fire-and-forget: a handler failing never reaches the publisher.
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

  // Log rules (record to history / push a notification); it checks the event type itself.
  handleReceivedEvent(body).catch((err: unknown) => {
    console.warn(`Log rule handling failed for ${req.type}: ${(err as Error).message}`);
  });
}
