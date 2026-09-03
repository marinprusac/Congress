import { useCallback, useEffect, useRef } from "react";

interface UseAutosaveOptions<T> {
  // The current draft value to persist - must be JSON-serializable (plain
  // strings/objects of primitives), since changes are detected by content,
  // not object identity, so a value rebuilt fresh each render is fine.
  value: T;
  onSave: (value: T) => void;
  // Debounce before an in-progress edit is persisted. Kept short (not
  // Google-Docs-short) since there's no "Saved" indicator anywhere in this
  // app to reassure the owner a longer wait is still pending.
  delayMs?: number;
  // Skip persisting entirely, e.g. before the initial server value has
  // loaded and there's nothing real to diff the draft against yet.
  enabled?: boolean;
}

function contentKey(value: unknown): string {
  return JSON.stringify(value);
}

// Debounced, flush-on-unmount autosave: call once per page/field-group with
// the current draft value, and every change persists on its own without an
// explicit Save action. Chosen over onBlur/leave-triggered saving alone so a
// long edit that never blurs the field still reaches the server.
export function useAutosave<T>({
  value,
  onSave,
  delayMs = 800,
  enabled = true,
}: UseAutosaveOptions<T>): { markSaved: (value: T) => void } {
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const valueRef = useRef(value);
  valueRef.current = value;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const lastSavedKeyRef = useRef(contentKey(value));

  useEffect(() => {
    if (!enabled || contentKey(value) === lastSavedKeyRef.current) return;
    const timer = setTimeout(() => {
      lastSavedKeyRef.current = contentKey(valueRef.current);
      onSaveRef.current(valueRef.current);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [value, enabled, delayMs]);

  // Flushes any pending edit when the field/page unmounts (e.g. the owner
  // navigates away mid-debounce) - added once, reads the latest draft via
  // the ref above rather than closing over `value` from this render.
  useEffect(() => {
    return () => {
      if (enabledRef.current && contentKey(valueRef.current) !== lastSavedKeyRef.current) {
        onSaveRef.current(valueRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lets a caller declare a freshly-loaded (not user-edited) value as
  // already-saved - e.g. right after populating draft state from the
  // server, so the next render doesn't read as a change worth persisting.
  const markSaved = useCallback((v: T) => {
    lastSavedKeyRef.current = contentKey(v);
  }, []);

  return { markSaved };
}
