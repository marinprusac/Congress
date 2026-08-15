import type { DocumentSummary, DocumentDetail, UpdateDocumentRequest } from "../../../src/types";
import { resolveApiBase, parseJsonResponse as json, assertDeleteOk } from "@congress/congress-ui";

const API_BASE = resolveApiBase("documents", import.meta.env.PROD);

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
  assertDeleteOk(res, "delete document");
}

export function downloadUrl(id: number): string {
  return `${API_BASE}/documents/${id}/download`;
}
