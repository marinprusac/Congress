import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";
import { useExhibitSearch } from "./useExhibitSearch.js";
import { buildExhibitToken } from "./token.js";
import { getCaretCoordinates } from "./caretCoordinates.js";

type PickerElement = HTMLTextAreaElement | HTMLInputElement;

interface TriggerState {
  triggerStart: number;
  query: string;
  cursor: number;
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
  // Pixel offset of the "[[" trigger within the field, relative to its own
  // top-left corner - null for an <input> (single line, caret math doesn't
  // matter) or before the first measurement. Lets the dropdown anchor next
  // to where the user is actually typing instead of the bottom of the
  // field, which can be many screens away from the caret once the field
  // has auto-resized to a long note's full height.
  caretPosition: { top: number; left: number } | null;
  // Spread onto the target <textarea>/<input>. Deliberately does NOT include
  // value/onChange - the field stays owned by the consumer's own state.
  fieldProps: {
    ref: (el: PickerElement | null) => void;
    onKeyDown: (e: ReactKeyboardEvent<PickerElement>) => void;
    onSelect: () => void;
    onClick: () => void;
  };
}

interface UseExhibitPickerOptions {
  // Current value of the (controlled) field being watched.
  value: string;
  // Called when a selection replaces the "[[query" span with a real token.
  onChange: (newValue: string, newCursor: number) => void;
}

// Detects "[[" typed immediately before the cursor (with no "]]" or newline
// since), tracking the query text as the user keeps typing, so a consumer
// can drive an <ExhibitPickerDropdown> off the returned state.
//
// Detection deliberately runs in an effect keyed on the *controlled* value,
// rather than from a native "input" listener on the element. A native
// listener attached directly to the element fires before React's delegated
// onChange, so calling setState from it re-renders the controlled field
// while the consumer's state still holds the previous value - React then
// writes that stale value back to the DOM and the keystroke that caused it
// is silently erased. In practice that ate the second "[" of every "[[",
// i.e. exactly the keystroke that first produces a trigger. Reading
// selection in an effect (after React has committed the new value) avoids
// racing the controlled value entirely.
export function useExhibitPicker({ value, onChange }: UseExhibitPickerOptions): ExhibitPickerState {
  const [element, setElement] = useState<PickerElement | null>(null);
  const attachRef = useCallback((el: PickerElement | null) => setElement(el), []);

  const [trigger, setTrigger] = useState<TriggerState | null>(null);
  const [caretPosition, setCaretPosition] = useState<{ top: number; left: number } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // Bumped by caret-only movements (click / arrow keys / selection changes),
  // which don't alter `value` but can still open or close the picker.
  const [caretTick, setCaretTick] = useState(0);
  const bumpCaret = useCallback(() => setCaretTick((t) => t + 1), []);

  const { results, loading } = useExhibitSearch(trigger?.query ?? "", trigger !== null);

  const triggerRef = useRef(trigger);
  triggerRef.current = trigger;
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  useEffect(() => setActiveIndex(0), [trigger?.query]);

  const close = useCallback(() => setTrigger(null), []);

  // Runs after commit, so `element.value` and its selection already reflect
  // `value` - safe to read without fighting the controlled field.
  useEffect(() => {
    if (!element) {
      setTrigger(null);
      return;
    }
    if (document.activeElement !== element) return;

    const cursor = element.selectionStart ?? value.length;
    const beforeCursor = value.slice(0, cursor);
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

    if (element instanceof HTMLTextAreaElement) {
      // Anchored to where "[[" was typed, not the live cursor - keeps the
      // dropdown still while the query after it keeps changing.
      const coords = getCaretCoordinates(element, triggerStart);
      const lineHeight = parseFloat(window.getComputedStyle(element).lineHeight);
      setCaretPosition({ top: coords.top + (Number.isFinite(lineHeight) ? lineHeight : 20), left: coords.left });
    } else {
      setCaretPosition(null);
    }
  }, [element, value, caretTick]);

  const select = useCallback(
    (result: CapitolExhibitSearchResult) => {
      const current = triggerRef.current;
      if (!element || !current) return;

      const token = buildExhibitToken({ chamber: result.chamber, id: result.id });
      const inserted = `[[${token}|${result.name}]]`;
      const newValue = value.slice(0, current.triggerStart) + inserted + value.slice(current.cursor);
      const newCursor = current.triggerStart + inserted.length;

      onChange(newValue, newCursor);
      setTrigger(null);

      requestAnimationFrame(() => {
        element.focus();
        element.setSelectionRange(newCursor, newCursor);
      });
    },
    [element, value, onChange]
  );
  const selectRef = useRef(select);
  selectRef.current = select;

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<PickerElement>) => {
      if (!triggerRef.current) return;

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
    },
    []
  );

  return {
    open: trigger !== null,
    query: trigger?.query ?? "",
    results,
    loading,
    activeIndex,
    setActiveIndex,
    select,
    close,
    caretPosition,
    fieldProps: { ref: attachRef, onKeyDown, onSelect: bumpCaret, onClick: bumpCaret },
  };
}
