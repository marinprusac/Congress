import type { Hono } from "hono";
import type { FieldKind, KeyKind } from "@congress/shared-types";
import type { PublishedEvent } from "../events.js";
import type { Evidence } from "../typeEngine/lookups.js";

// A connector: hand-written sync code with its own cache DB. Bindings map its
// source records into types; it never writes type records itself.

export interface SourceKind {
  kind: string;
  label: string;
  // A relation field holds record ids of `target` (e.g. linked People).
  fields: { slug: string; kind: FieldKind; label: string; many?: boolean; target?: string }[];
  keys?: { field: string; kind: KeyKind }[];
  // Per-record capabilities the connector computes, e.g. editable.
  facts: { slug: string; label: string }[];
}

export type SourceValue = string | number | boolean | null | string[];

export interface SourceRecord {
  kind: string;
  key: string;
  values: Record<string, SourceValue>;
  facts: Record<string, SourceValue>;
  updatedAt: string | null;
}

export interface SyncResult {
  changed: number;
  // One line per failing account/calendar, or null when all went fine.
  error: string | null;
}

export interface ConnectorContext {
  name: string;
  google: {
    accounts(): { id: number; label: string; email: string; needsReconnect: boolean }[];
    fetch(accountId: number, url: string, init?: RequestInit): Promise<unknown>;
  };
  people: {
    // An existing Person with this email, or null. Never creates.
    find(email: string): string | null;
    // Finds or creates by email; only direct contact (evidence "corresponded") should create.
    resolve(input: { email: string; name?: string | null }, evidence: Evidence): string | null;
  };
  emitChange(kind: string, key: string, deleted?: boolean): void;
  syncNow(): void;
  reschedule(): void;
}

export interface Connector {
  name: string;
  label: string;
  googleScopes?: string[];
  source: SourceKind[];
  start(ctx: ConnectorContext): Promise<void> | void;
  stop?(): Promise<void> | void;
  sync(ctx: ConnectorContext): Promise<SyncResult>;
  intervalMs?(): number;
  read: {
    get(kind: string, key: string): SourceRecord | null;
    list(kind: string, opts?: { from?: string; to?: string }): SourceRecord[];
    // Where a new record can go (e.g. writable calendars): values for the create target field.
    targets?(kind: string): { value: string; label: string; group?: string }[];
  };
  push?: {
    create(ctx: ConnectorContext, kind: string, values: Record<string, SourceValue>): Promise<SourceRecord>;
    update(ctx: ConnectorContext, kind: string, key: string, patch: Record<string, SourceValue>): Promise<SourceRecord>;
    delete(ctx: ConnectorContext, kind: string, key: string): Promise<void>;
    act(ctx: ConnectorContext, kind: string, key: string, action: string, args: Record<string, SourceValue>): Promise<SourceRecord>;
  };
  // Setup-panel API, mounted at /congress/connectors/<name>/*.
  routes?(ctx: ConnectorContext): Hono;
  onEvent?(ctx: ConnectorContext, event: PublishedEvent): void;
}

export function defineConnector(connector: Connector): Connector {
  return connector;
}

// A push the source's facts don't allow (e.g. editing someone else's event).
export class ConnectorRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorRefusedError";
  }
}
