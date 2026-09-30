import type { Connector, ConnectorContext } from "./contract.js";
import { createSyncScheduler, type SyncStatus } from "./scheduler.js";
import { addConnector, emitConnectorSynced, emitSourceChange, removeConnector } from "./runtime.js";
import { googleApiFetch } from "./googleApi.js";
import { listGoogleAccounts } from "./google/accounts.js";
import { onEventPublished } from "../events.js";
import { getTypeBySlug } from "../typeEngine/store.js";
import { activeFields } from "../typeEngine/operations.js";
import { lookupOrCreate, type Evidence } from "../typeEngine/lookups.js";
import { findByKey } from "../typeEngine/keys.js";
import { normalizeKey } from "../typeEngine/keyValues.js";

const DEFAULT_INTERVAL_MS = 5 * 60_000;

export interface ConnectorStatus extends SyncStatus {
  name: string;
  label: string;
  state: "active" | "offline";
}

interface Running {
  connector: Connector;
  ctx: ConnectorContext;
  scheduler: ReturnType<typeof createSyncScheduler>;
  state: "active" | "offline";
  startError: string | null;
}

const running = new Map<string, Running>();
let unsubscribe: (() => void) | null = null;

export function resolvePerson(input: { email: string; name?: string | null }, evidence: Evidence, actor: string): string | null {
  const t = getTypeBySlug("person");
  if (!t || t.definition.hidden) return null;
  const title = activeFields(t.definition).find((f) => f.id === t.definition.titleField);
  const name = input.name?.trim();
  try {
    const result = lookupOrCreate("person", {
      keys: [{ kind: "email", value: input.email }],
      values: title && name ? { [title.slug]: name } : undefined,
      evidence,
      actor,
    });
    return result.id;
  } catch (err) {
    console.warn(`Person lookup for ${input.email} failed: ${(err as Error).message}`);
    return null;
  }
}

export function findPerson(email: string): string | null {
  const t = getTypeBySlug("person");
  const value = normalizeKey("email", email);
  if (!t || t.definition.hidden || !value) return null;
  return findByKey(t.id, "email", value) ?? null;
}

export function makeContext(connector: Connector, hooks: { syncNow(): void; reschedule(): void }): ConnectorContext {
  return {
    name: connector.name,
    google: {
      accounts: () => listGoogleAccounts().map((a) => ({ id: a.id, label: a.label, email: a.email, needsReconnect: a.needsReconnect })),
      fetch: (accountId, url, init) => googleApiFetch(accountId, connector.googleScopes ?? [], url, init),
    },
    people: { find: findPerson, resolve: (input, evidence) => resolvePerson(input, evidence, connector.name) },
    emitChange: (kind, key, deleted = false) => emitSourceChange({ connector: connector.name, kind, key, deleted }),
    ...hooks,
  };
}

// Starts each connector and its sync loop; one that throws is marked offline.
export async function startConnectors(list: Connector[], opts: { context?: (c: Connector, hooks: { syncNow(): void; reschedule(): void }) => ConnectorContext } = {}): Promise<void> {
  for (const connector of list) {
    const hooks = {
      syncNow: () => void running.get(connector.name)?.scheduler.syncNow(),
      reschedule: () => running.get(connector.name)?.scheduler.reschedule(),
    };
    const ctx = (opts.context ?? makeContext)(connector, hooks);
    const scheduler = createSyncScheduler({
      sync: async () => {
        const result = await connector.sync(ctx);
        emitConnectorSynced(connector.name);
        return result.error;
      },
      intervalMs: () => connector.intervalMs?.() ?? DEFAULT_INTERVAL_MS,
    });
    const entry: Running = { connector, ctx, scheduler, state: "active", startError: null };
    running.set(connector.name, entry);
    try {
      await connector.start(ctx);
      addConnector(connector);
      scheduler.start();
    } catch (err) {
      entry.state = "offline";
      entry.startError = (err as Error).message;
      console.error(`Connector ${connector.name} failed to start: ${entry.startError}`);
    }
  }
  unsubscribe ??= onEventPublished((event) => {
    for (const r of running.values()) {
      if (r.state !== "active" || !r.connector.onEvent) continue;
      try {
        r.connector.onEvent(r.ctx, event);
      } catch (err) {
        console.warn(`Connector ${r.connector.name} failed on ${event.type}: ${(err as Error).message}`);
      }
    }
  });
}

export async function stopConnectors(): Promise<void> {
  unsubscribe?.();
  unsubscribe = null;
  for (const r of running.values()) {
    r.scheduler.stop();
    try {
      await r.connector.stop?.();
    } catch (err) {
      console.warn(`Connector ${r.connector.name} failed to stop: ${(err as Error).message}`);
    }
    removeConnector(r.connector.name);
  }
  running.clear();
}

export function connectorStatus(name: string): ConnectorStatus | null {
  const r = running.get(name);
  if (!r) return null;
  const sync = r.scheduler.status();
  return { name, label: r.connector.label, state: r.state, ...sync, lastError: r.startError ?? sync.lastError };
}

export function listConnectorStatuses(): ConnectorStatus[] {
  return [...running.keys()].map((name) => connectorStatus(name)!);
}

export function runningConnector(name: string): { connector: Connector; ctx: ConnectorContext } | null {
  const r = running.get(name);
  return r && r.state === "active" ? { connector: r.connector, ctx: r.ctx } : null;
}

export async function syncConnector(name: string): Promise<ConnectorStatus | null> {
  const r = running.get(name);
  if (!r || r.state !== "active") return null;
  await r.scheduler.syncNow();
  return connectorStatus(name);
}
