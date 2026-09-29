import type { GoogleConnectorHost } from "./google.js";
import type { EventPublishRequest, ExhibitSyncRequest, CapitolExhibitResolveResult, ExhibitToken } from "@congress/shared-types";

// What Congress provides to the Chambers it hosts in-process. Congress
// installs one at boot (setCongressHost); Chambers reach it only through the
// kit helpers below, never by importing Congress.
export interface CongressHost {
  publishEvent(event: EventPublishRequest): void;
  syncExhibit(push: ExhibitSyncRequest): void;
  resolveExhibits(refs: ExhibitToken[]): Promise<CapitolExhibitResolveResult[]>;
  google?: GoogleConnectorHost;
}

let host: CongressHost | null = null;

export function setCongressHost(next: CongressHost | null): void {
  host = next;
}

// Null outside Congress (a Chamber's own unit tests) - every caller treats
// that as "nobody is listening", the same as a best-effort call that failed.
export function getCongressHost(): CongressHost | null {
  return host;
}
