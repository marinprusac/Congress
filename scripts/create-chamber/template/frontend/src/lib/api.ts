import type { ItemSummary, ItemDetail, CreateItemRequest, UpdateItemRequest } from "../../../src/types";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";
import { resolveApiBase, parseJsonResponse as json, assertDeleteOk } from "@congress/congress-ui";

const API_BASE = resolveApiBase("__CHAMBER_NAME__", import.meta.env.PROD);

export function fetchItems(): Promise<ItemSummary[]> {
  return fetch(`${API_BASE}/items`).then((res) => json(res));
}

export function fetchRecentItems(): Promise<ItemSummary[]> {
  return fetch(`${API_BASE}/items/recent`).then((res) => json(res));
}

export function searchItems(query: string): Promise<ItemSummary[]> {
  return fetch(`${API_BASE}/items/search?q=${encodeURIComponent(query)}`).then((res) => json(res));
}

export function fetchItem(id: number): Promise<ItemDetail> {
  return fetch(`${API_BASE}/items/${id}`).then((res) => json(res));
}

export function createItem(input: CreateItemRequest): Promise<ItemDetail> {
  return fetch(`${API_BASE}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export function updateItem(id: number, input: UpdateItemRequest): Promise<ItemDetail> {
  return fetch(`${API_BASE}/items/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export async function deleteItem(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/items/${id}`, { method: "DELETE" });
  assertDeleteOk(res, "delete item");
}

// Quick-create an item from a "[[" picker or the References panel's "+
// Create" option, without leaving the field the user was in - mirrors
// Obsidian's "create note from link", scoped to this Chamber the same way
// every other Chamber's frontend/src/lib/api.ts scopes its own
// quickCreate<Entity>Exhibit to its own Exhibit type.
export async function quickCreateItemExhibit(title: string): Promise<CapitolExhibitSearchResult> {
  const item = await createItem({ name: title, body: "" });
  return { chamber: "__CHAMBER_NAME__", id: `item-${item.id}`, type: "item", name: item.name, url: `/i/${item.id}` };
}
