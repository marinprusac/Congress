import { useCallback, useState } from "react";

const ORDER_STORAGE_KEY = "congress-chamber-order";

function readStoredOrder(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(ORDER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeStoredOrder(order: string[]): void {
  try {
    localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    // Storage full/unavailable (private browsing) - ordering just resets
    // next load, not worth surfacing to the owner.
  }
}

// Persists the owner's preferred ordering of NavPanel's Chambers list, per
// device (localStorage, not a Congress-wide setting) - this is a personal
// arrangement, not something that needs to sync across the owner's phone
// and laptop. `names` is always the live registry order (source of truth
// for *which* Chambers exist); this hook only reorders it, folding in any
// name the stored order doesn't know about yet (a newly registered
// Chamber) at the end, in registry order. Reordering itself is a
// long-press-and-drag gesture (useReorderableList), which needs to set a
// whole new order at once (a drag can jump several positions in one move),
// hence `setOrder` taking a full array rather than a single-step move.
export function useChamberOrder(names: string[]): {
  order: string[];
  setOrder: (next: string[]) => void;
} {
  const [stored, setStored] = useState<string[]>(readStoredOrder);

  const order = [...stored.filter((name) => names.includes(name)), ...names.filter((name) => !stored.includes(name))];

  const setOrder = useCallback((next: string[]) => {
    setStored(next);
    writeStoredOrder(next);
  }, []);

  return { order, setOrder };
}
