import type { Connector } from "./contract.js";

// Leaf module: the started connectors and source-change listeners, so
// accounts.ts can read scopes without importing the registry.

const connectors = new Map<string, Connector>();

export function addConnector(c: Connector): void {
  connectors.set(c.name, c);
}

export function removeConnector(name: string): void {
  connectors.delete(name);
}

export function listConnectors(): Connector[] {
  return [...connectors.values()];
}

export function getConnector(name: string): Connector | undefined {
  return connectors.get(name);
}

export interface SourceChange {
  connector: string;
  kind: string;
  key: string;
  deleted: boolean;
}

const changeListeners = new Set<(change: SourceChange) => void>();

// Bindings subscribe here; no event goes on the relay.
export function onSourceChange(listener: (change: SourceChange) => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

const syncListeners = new Set<(connector: string) => void>();

// After every sync run (bindings reconcile what changed without an emit).
export function onConnectorSynced(listener: (connector: string) => void): () => void {
  syncListeners.add(listener);
  return () => syncListeners.delete(listener);
}

export function emitConnectorSynced(connector: string): void {
  for (const listener of syncListeners) {
    try {
      listener(connector);
    } catch (err) {
      console.warn(`Sync listener failed: ${(err as Error).message}`);
    }
  }
}

export function emitSourceChange(change: SourceChange): void {
  for (const listener of changeListeners) {
    try {
      listener(change);
    } catch (err) {
      console.warn(`Source change listener failed: ${(err as Error).message}`);
    }
  }
}
