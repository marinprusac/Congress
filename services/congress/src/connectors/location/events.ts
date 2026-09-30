import type { ConnectorContext } from "../contract.js";

// Tracking publishes map.* events through the running connector's context.
let ctx: ConnectorContext | null = null;

export function setEventContext(c: ConnectorContext | null): void {
  ctx = c;
}

export async function publishEvent(event: { type: string; payload: Record<string, unknown> }): Promise<void> {
  ctx?.publish(event.type, event.payload);
}
