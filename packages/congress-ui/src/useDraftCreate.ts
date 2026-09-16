import { useCallback, useEffect, useRef } from "react";
import { shouldFireDraftCreate } from "./draftCreate.js";
import type { DraftCreateState } from "./draftCreate.js";

interface UseDraftCreateOptions<T> {
  // The current draft value - read at attempt-time via a ref, so a caller
  // rebuilding this fresh each render (e.g. `{ title, content }`) is fine.
  value: T;
  // Whether there's enough to create yet (e.g. a non-empty title).
  canCreate: (value: T) => boolean;
  onCreate: (value: T) => void;
}

// Fires `onCreate` at most once, on demand (call the returned `attempt` -
// typically from a title/name field's `onBlur`) instead of on a content
// debounce, so creating an Exhibit doesn't fire mid-keystroke. A flush on
// unmount is the net for a draft abandoned before that field ever blurs
// (e.g. the back button while it's still focused).
export function useDraftCreate<T>({ value, canCreate, onCreate }: UseDraftCreateOptions<T>): {
  attempt: () => void;
  reset: () => void;
} {
  const stateRef = useRef<DraftCreateState>("idle");
  const valueRef = useRef(value);
  valueRef.current = value;
  const canCreateRef = useRef(canCreate);
  canCreateRef.current = canCreate;
  const onCreateRef = useRef(onCreate);
  onCreateRef.current = onCreate;

  const attempt = useCallback(() => {
    if (!shouldFireDraftCreate(stateRef.current, canCreateRef.current(valueRef.current))) return;
    stateRef.current = "fired";
    onCreateRef.current(valueRef.current);
  }, []);

  // Lets a failed create (e.g. a network error) be retried on the next
  // blur/unmount instead of staying permanently stuck as "fired".
  const reset = useCallback(() => {
    stateRef.current = "idle";
  }, []);

  useEffect(() => {
    return () => attempt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { attempt, reset };
}
