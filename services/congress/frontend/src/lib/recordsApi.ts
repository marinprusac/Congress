import type { CapitolExhibitSearchResult, ExhibitSearchResult, FileRef, RecordDto, RecordValue, RelatedGroup, TypeOverview, TypeSummary, TypeVersion } from "@congress/shared-types";

// Runtime exhibit types and their records (server: src/typeEngine/routes.ts).

export const TYPES_KEY = ["congress", "types"] as const;

export class RecordConflict extends Error {
  constructor(
    public readonly field: string,
    message?: string
  ) {
    super(message ? `${message[0]!.toUpperCase()}${message.slice(1)}.` : `Another record already has this ${field}.`);
  }
}

async function check<T>(res: Response): Promise<T> {
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { field?: string; message?: string };
    throw new RecordConflict(body.field ?? "value", body.message);
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

export async function fetchTypeOverviews(): Promise<TypeOverview[]> {
  return check(await fetch("/congress/types?all=1"));
}

export async function fetchTypeVersions(slug: string): Promise<TypeVersion[]> {
  return check(await fetch(`/congress/types/${encodeURIComponent(slug)}/versions`));
}

export async function fetchRecord(id: string): Promise<RecordDto> {
  return check(await fetch(`/congress/records/${encodeURIComponent(id)}`));
}

export async function fetchRelated(id: string): Promise<RelatedGroup[]> {
  return check(await fetch(`/congress/records/${encodeURIComponent(id)}/related`));
}

// One type's records matching q (recent ones when q is empty).
export async function searchRecords(type: string, q: string): Promise<ExhibitSearchResult[]> {
  return check(await fetch(`/congress/records/search?type=${encodeURIComponent(type)}&q=${encodeURIComponent(q)}`));
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

export function fileUrl(id: string, download = false): string {
  return `/congress/files/${encodeURIComponent(id)}${download ? "?download=1" : ""}`;
}

// Streams the file as the raw request body; the id goes into a file field.
export async function uploadFile(file: File): Promise<FileRef> {
  const res = await fetch(`/congress/files?name=${encodeURIComponent(file.name)}`, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (res.status === 413) {
    const body = (await res.json().catch(() => ({}))) as { maxBytes?: number };
    throw new Error(`That file is too large${body.maxBytes ? ` (max ${Math.round(body.maxBytes / 1024 / 1024)} MB)` : ""}.`);
  }
  return check(res);
}

// The "@" picker's "create new": a record of the given type, titled.
export async function quickCreateRecord(type: TypeSummary, title: string): Promise<CapitolExhibitSearchResult> {
  const titleField = type.definition.fields.find((f) => f.id === type.definition.titleField);
  const created = await createRecord(type.definition.slug, titleField ? { [titleField.slug]: title } : {});
  return { id: created.id, chamber: "e", type: created.type, name: title, url: `/${created.id}` };
}
