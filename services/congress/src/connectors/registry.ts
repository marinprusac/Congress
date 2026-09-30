import type { Connector, ConnectorContext, PersonKey } from "./contract.js";
import { createSyncScheduler, type SyncStatus } from "./scheduler.js";
import { addConnector, emitConnectorSynced, emitSourceChange, removeConnector } from "./runtime.js";
import { googleApiFetch } from "./googleApi.js";
import { listGoogleAccounts } from "./google/accounts.js";
import { onEventPublished, publishEvent } from "../events.js";
import { getTypeBySlug, listTypes } from "../typeEngine/store.js";
import { findBySource, getRecord, listRecords, onRecordWrite } from "../typeEngine/records.js";
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
let unsubscribeRecords: (() => void) | null = null;

const keysOf = (k: PersonKey) => [
  ...(k.email ? [{ kind: "email" as const, value: k.email }] : []),
  ...(k.phone ? [{ kind: "phone" as const, value: k.phone }] : []),
];

export function resolvePerson(input: PersonKey & { name?: string | null }, evidence: Evidence, actor: string): string | null {
  const t = getTypeBySlug("person");
  if (!t || t.definition.hidden || keysOf(input).length === 0) return null;
  const title = activeFields(t.definition).find((f) => f.id === t.definition.titleField);
  const name = input.name?.trim();
  try {
    const result = lookupOrCreate("person", {
      keys: keysOf(input),
      values: title && name ? { [title.slug]: name } : undefined,
      evidence,
      actor,
    });
    return result.id;
  } catch (err) {
    console.warn(`Person lookup for ${input.email ?? input.phone} failed: ${(err as Error).message}`);
    return null;
  }
}

export function findPerson(key: string | PersonKey): string | null {
  const t = getTypeBySlug("person");
  if (!t || t.definition.hidden) return null;
  for (const k of keysOf(typeof key === "string" ? { email: key } : key)) {
    const value = normalizeKey(k.kind, k.value);
    const id = value ? findByKey(t.id, k.kind, value) : undefined;
    if (id) return id;
  }
  return null;
}

export function recordFor(connector: string, kind: string, key: string): string | null {
  for (const t of listTypes({ includeHidden: true })) {
    for (const b of t.definition.bindings) {
      if (b.connector !== connector || b.kind !== kind) continue;
      const id = findBySource(t, b.id, key);
      if (id) return id;
    }
  }
  return null;
}

export function listTypeRecords(type: string): { id: string; values: Record<string, unknown> }[] {
  if (!getTypeBySlug(type)) return [];
  return listRecords(type, { limit: 100_000 }).map((r) => ({ id: r.id, values: r.values }));
}

export function makeContext(connector: Connector, hooks: { syncNow(): void; reschedule(): void }): ConnectorContext {
  return {
    name: connector.name,
    google: {
      accounts: () => listGoogleAccounts().map((a) => ({ id: a.id, label: a.label, email: a.email, needsReconnect: a.needsReconnect, scopes: a.scopes })),
      fetch: (accountId, url, init, scopes) => googleApiFetch(accountId, scopes ?? connector.googleScopes ?? [], url, init),
    },
    people: { find: findPerson, resolve: (input, evidence) => resolvePerson(input, evidence, connector.name) },
    emitChange: (kind, key, deleted = false, quiet = false) => emitSourceChange({ connector: connector.name, kind, key, deleted, quiet }),
    records: { idFor: (kind, key) => recordFor(connector.name, kind, key), list: listTypeRecords },
    publish: (type, payload) => publishEvent({ chamber: connector.name, type, payload }),
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
  // Record writes reach connectors that read records as input.
  unsubscribeRecords ??= onRecordWrite((t, id, deleted, info) => {
    const values = deleted ? undefined : getRecord(id)?.values;
    const op = deleted ? ("delete" as const) : info?.op === "create" ? ("create" as const) : ("update" as const);
    const change = { type: t.definition.slug, id, op, values };
    for (const r of running.values()) {
      if (r.state !== "active" || !r.connector.onRecordChange) continue;
      try {
        r.connector.onRecordChange(r.ctx, change);
      } catch (err) {
        console.warn(`Connector ${r.connector.name} failed on a ${change.type} change: ${(err as Error).message}`);
      }
    }
  });
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
  unsubscribeRecords?.();
  unsubscribeRecords = null;
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
