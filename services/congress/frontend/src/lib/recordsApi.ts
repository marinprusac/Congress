import type { CapitolExhibitSearchResult, RecordDto, RecordValue, TypeSummary } from "@congress/shared-types";

// Runtime exhibit types and their records (server: src/typeEngine/routes.ts).

export class RecordConflict extends Error {
  constructor(public readonly field: string) {
    super(`Another record already has this ${field}.`);
  }
}

async function check<T>(res: Response): Promise<T> {
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { field?: string };
    throw new RecordConflict(body.field ?? "value");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// Hidden types are included: a direct /e/... link to one still renders.
export async function fetchTypes(): Promise<TypeSummary[]> {
  return check(await fetch("/congress/types?all=1"));
}

export async function fetchRecord(id: string): Promise<RecordDto> {
  return check(await fetch(`/congress/records/${encodeURIComponent(id)}`));
}

export async function createRecord(type: string, values: Record<string, RecordValue>): Promise<RecordDto> {
  return check(
    await fetch("/congress/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, values }),
    })
  );
}

export async function updateRecord(id: string, values: Record<string, RecordValue>): Promise<RecordDto> {
  return check(
    await fetch(`/congress/records/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    })
  );
}

export async function deleteRecord(id: string): Promise<void> {
  await check(await fetch(`/congress/records/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

// The "@" picker's "create new": a record of the given type, titled.
export async function quickCreateRecord(type: TypeSummary, title: string): Promise<CapitolExhibitSearchResult> {
  const titleField = type.definition.fields.find((f) => f.id === type.definition.titleField);
  const created = await createRecord(type.definition.slug, titleField ? { [titleField.slug]: title } : {});
  return { id: created.id, chamber: "e", type: created.type, name: title, url: `/${created.id}` };
}
