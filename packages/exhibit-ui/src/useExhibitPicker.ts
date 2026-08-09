import { useCallback, useEffect, useRef, useState } from "react";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";
import { useExhibitSearch } from "./useExhibitSearch.js";
import { buildExhibitToken } from "./token.js";

type PickerElement = HTMLTextAreaElement | HTMLInputElement;

interface TriggerState {
  triggerStart: number;
  query: string;
  cursor: number;
}

function sameTrigger(a: TriggerState | null, b: TriggerState | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.triggerStart === b.triggerStart && a.query === b.query && a.cursor === b.cursor;
}

export interface ExhibitPickerState {
  open: boolean;
  query: string;
  results: CapitolExhibitSearchResult[];
  loading: boolean;
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  select: (result: CapitolExhibitSearchResult) => void;
  close: () => void;
  // Explicitly opens the picker at the current cursor (inserting "[[" if
  // needed) - a guaranteed-to-work fallback for mobile keyboards where
  // detecting "[[" from raw keystrokes is unreliable (autocorrect/predictive
  // text can intercept or rewrite bracket characters before they ever reach
  // the DOM's "input" event in a form this hook can parse).
  openHere: () => void;
  // Attach to the target textarea/input's `ref` prop.
  attachRef: (el: PickerElement | null) => void;
}

// Detects "[[" typed immediately before the cursor (with no "]]" or newline
// since), tracking the query text as the user keeps typing, so a consumer
// can drive an <ExhibitPickerDropdown> off the returned state.
//
// Takes ownership of the target element via `attachRef` (a callback ref)
// rather than accepting an external RefObject. A callback ref is the only
// reliable way to know exactly when the element mounts/unmounts - an
// earlier version accepted a plain RefObject and tried to react to it via a
// useEffect dependency, but `ref.current` is read during render, before the
// browser has actually attached the DOM node during commit, so the
// dependency array never saw the change and listeners were never attached
// at all. All listeners are attached exactly once per mounted element (not
// re-bound on every keystroke) - doing that on every keystroke was enough
// to make mobile browsers reset the textarea's caret to the end of the
// value and occasionally drop the next keystroke.
export function useExhibitPicker(onInsert: (newValue: string, newCursor: number) => void): ExhibitPickerState {
  const [element, setElement] = useState<PickerElement | null>(null);
  const attachRef = useCallback((el: PickerElement | null) => setElement(el), []);

  const [trigger, setTriggerState] = useState<TriggerState | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const { results, loading } = useExhibitSearch(trigger?.query ?? "");

  const triggerRef = useRef(trigger);
  // Only actually update state (and trigger a re-render) when something
  // meaningfully changed - re-renders caused by "input" and "keyup" both
  // firing for the same keystroke, mid-typing, are exactly the kind of
  // extra churn that has been observed to interfere with mobile virtual
  // keyboards/autocorrect.
  const setTrigger = useCallback((next: TriggerState | null) => {
    if (sameTrigger(triggerRef.current, next)) return;
    triggerRef.current = next;
    setTriggerState(next);
  }, []);

  const resultsRef = useRef(results);
  resultsRef.current = results;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  useEffect(() => setActiveIndex(0), [trigger?.query]);

  const close = useCallback(() => setTrigger(null), [setTrigger]);

  const select = useCallback(
    (result: CapitolExhibitSearchResult) => {
      const current = triggerRef.current;
      if (!element || !current) return;

      const token = buildExhibitToken({ chamber: result.chamber, id: result.id });
      const inserted = `[[${token}|${result.name}]]`;
      const value = element.value;
      const newValue = value.slice(0, current.triggerStart) + inserted + value.slice(current.cursor);
      const newCursor = current.triggerStart + inserted.length;

      onInsert(newValue, newCursor);
      setTrigger(null);

      requestAnimationFrame(() => {
        element.focus();
        element.setSelectionRange(newCursor, newCursor);
      });
    },
    [element, onInsert, setTrigger]
  );
  const selectRef = useRef(select);
  selectRef.current = select;

  const openHere = useCallback(() => {
    if (!element) return;
    // If the field wasn't already focused, its selection defaults to 0
    // rather than reflecting where the user would expect to type next -
    // treat that case as "start from the end" instead of inserting at the
    // very beginning of existing text.
    const wasFocused = document.activeElement === element;
    element.focus();
    const cursor = wasFocused ? (element.selectionStart ?? element.value.length) : element.value.length;
    const value = element.value;
    const beforeCursor = value.slice(0, cursor);
    // Already sitting right after an open "[[" (e.g. the auto-detector
    // caught it but the dropdown got dismissed) - just reopen in place
    // instead of inserting a second pair.
    const existingStart = beforeCursor.lastIndexOf("[[");
    if (existingStart !== -1) {
      const between = beforeCursor.slice(existingStart + 2);
      if (!between.includes("]]") && !between.includes("\n")) {
        setTrigger({ triggerStart: existingStart, query: between, cursor });
        return;
      }
    }

    const newValue = beforeCursor + "[[" + value.slice(cursor);
    const newCursor = cursor + 2;
    onInsert(newValue, newCursor);
    setTrigger({ triggerStart: cursor, query: "", cursor: newCursor });

    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(newCursor, newCursor);
    });
  }, [element, onInsert, setTrigger]);

  useEffect(() => {
    if (!element) return;
    const el = element;

    function detectTrigger(e?: Event) {
      // Skip while a mobile IME/autocorrect composition is in progress -
      // reading `el.value` mid-composition can catch a transient,
      // about-to-be-replaced string, and setting state here has been
      // observed to interrupt the composition on Android. `compositionend`
      // (registered below) re-runs this once the composed text settles.
      if (e instanceof InputEvent && e.isComposing) return;

      const cursor = el.selectionStart ?? el.value.length;
      const beforeCursor = el.value.slice(0, cursor);
      const triggerStart = beforeCursor.lastIndexOf("[[");
      if (triggerStart === -1) {
        setTrigger(null);
        return;
      }
      const between = beforeCursor.slice(triggerStart + 2);
      if (between.includes("]]") || between.includes("\n")) {
        setTrigger(null);
        return;
      }
      setTrigger({ triggerStart, query: between, cursor });
    }

    function handleKeyDown(e: KeyboardEvent) {
      const current = triggerRef.current;
      if (!current) return;

      if (e.key === "Escape") {
        e.preventDefault();
        setTrigger(null);
        return;
      }

      const currentResults = resultsRef.current;
      if (currentResults.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % currentResults.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + currentResults.length) % currentResults.length);
      } else if (e.key === "Enter") {
        const active = currentResults[activeIndexRef.current];
        if (active) {
          e.preventDefault();
          selectRef.current(active);
        }
      }
    }

    el.addEventListener("input", detectTrigger);
    el.addEventListener("click", detectTrigger);
    el.addEventListener("keyup", detectTrigger);
    el.addEventListener("compositionend", detectTrigger);
    el.addEventListener("keydown", handleKeyDown as EventListener);
    return () => {
      el.removeEventListener("input", detectTrigger);
      el.removeEventListener("click", detectTrigger);
      el.removeEventListener("keyup", detectTrigger);
      el.removeEventListener("compositionend", detectTrigger);
      el.removeEventListener("keydown", handleKeyDown as EventListener);
    };
  }, [element, setTrigger]);

  return {
    open: trigger !== null,
    query: trigger?.query ?? "",
    results,
    loading,
    activeIndex,
    setActiveIndex,
    select,
    close,
    openHere,
    attachRef,
  };
}
