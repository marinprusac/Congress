import { and, eq } from "drizzle-orm";

// Loosely-typed db/table (same trade-off as createSingleRowSettings) - the
// public boundary that matters, TOwnerId, stays strongly typed.
export interface ManualRefsTableConfig<TOwnerId extends string | number> {
  db: { select: (fields?: any) => any; insert: (table: any) => any; delete: (table: any) => any };
  table: any;
  ownerColumn: any;
  // Drizzle's .values() keys off the table's own inferred insert-object
  // property name (e.g. "noteId"), which can't be recovered from a runtime
  // Column object alone - hence this separate from ownerColumn.
  ownerKey: string;
  targetColumn: any;
}

// Manual (side-panel-added, as opposed to text-embedded) exhibit references
// for a Chamber whose exhibits are rows in one local table with an owner id
// column - notes/tasks/documents key by an integer row id; calendar (whose
// events aren't stored locally) keys by the full Exhibit id string instead.
export function createManualRefs<TOwnerId extends string | number>(config: ManualRefsTableConfig<TOwnerId>) {
  const { db, table, ownerColumn, ownerKey, targetColumn } = config;

  function listManualRefs(ownerId: TOwnerId): string[] {
    return db
      .select({ targetExhibitId: targetColumn })
      .from(table)
      .where(eq(ownerColumn, ownerId))
      .all()
      .map((r: { targetExhibitId: string }) => r.targetExhibitId);
  }

  function addManualRef(ownerId: TOwnerId, targetExhibitId: string): void {
    db.insert(table)
      .values({ [ownerKey]: ownerId, targetExhibitId, createdAt: new Date() })
      .onConflictDoNothing()
      .run();
  }

  function removeManualRef(ownerId: TOwnerId, targetExhibitId: string): void {
    db.delete(table).where(and(eq(ownerColumn, ownerId), eq(targetColumn, targetExhibitId))).run();
  }

  function deleteManualRefsForOwner(ownerId: TOwnerId): void {
    db.delete(table).where(eq(ownerColumn, ownerId)).run();
  }

  return { listManualRefs, addManualRef, removeManualRef, deleteManualRefsForOwner };
}

export interface ManualRefsByIdApi<TOwnerId> {
  listManualRefs: (ownerId: TOwnerId) => string[];
  addManualRef: (ownerId: TOwnerId, targetExhibitId: string) => void;
  removeManualRef: (ownerId: TOwnerId, targetExhibitId: string) => void;
}

// Translates chamber-kit's ManualRefsApi shape (exhibit-id-string keyed) on
// top of a createManualRefs() instance (numeric/string owner-id keyed),
// eliminating notes/tasks/documents' hand-written "ByExhibitId" wrappers.
export function createManualRefsByExhibitId<TOwnerId>(
  refs: ManualRefsByIdApi<TOwnerId>,
  parseId: (exhibitId: string) => TOwnerId | null
) {
  function listManualRefsByExhibitId(exhibitId: string): string[] | null {
    const id = parseId(exhibitId);
    return id === null ? null : refs.listManualRefs(id);
  }
  function addManualRefByExhibitId(exhibitId: string, targetExhibitId: string): boolean {
    const id = parseId(exhibitId);
    if (id === null) return false;
    refs.addManualRef(id, targetExhibitId);
    return true;
  }
  function removeManualRefByExhibitId(exhibitId: string, targetExhibitId: string): boolean {
    const id = parseId(exhibitId);
    if (id === null) return false;
    refs.removeManualRef(id, targetExhibitId);
    return true;
  }
  return { listManualRefsByExhibitId, addManualRefByExhibitId, removeManualRefByExhibitId };
}
