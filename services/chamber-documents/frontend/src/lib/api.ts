import type { DocumentSummary, DocumentDetail, UpdateDocumentRequest } from "@congress/shared-types";

// In production this Chamber's frontend is proxied through Capitol at
// "/documents/*", but its API calls still need to reach Capitol's gateway at
// "/api/documents/*" (Capitol forwards "/api/documents/<rest>" to this
// Chamber's own "/api/<rest>"). In dev, Vite proxies "/api" straight to this
// Chamber's own server, so no "/documents" segment is needed there.
const API_BASE = import.meta.env.PROD ? "/api/documents" : "/api";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.message ?? body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export function fetchDocuments(): Promise<DocumentSummary[]> {
  return fetch(`${API_BASE}/documents`).then((res) => json(res));
}

export function fetchDocument(id: number): Promise<DocumentDetail> {
  return fetch(`${API_BASE}/documents/${id}`).then((res) => json(res));
}

export function uploadDocument(input: { title: string; description: string; file: File }): Promise<DocumentDetail> {
  const form = new FormData();
  form.set("title", input.title);
  form.set("description", input.description);
  form.set("file", input.file);
  return fetch(`${API_BASE}/documents`, { method: "POST", body: form }).then((res) => json(res));
}

export function updateDocument(id: number, input: UpdateDocumentRequest): Promise<DocumentDetail> {
  return fetch(`${API_BASE}/documents/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export async function deleteDocument(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/documents/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to delete document: ${res.status}`);
  }
}

export function downloadUrl(id: number): string {
  return `${API_BASE}/documents/${id}/download`;
}
