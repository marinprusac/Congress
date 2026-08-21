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
  // Whether a "Create <query>" row should render after `results` - true
  // only when the consumer opted in via `onCreate` and no existing result's
  // name already matches the query exactly (case-insensitive).
  showCreate: boolean;
  creating: boolean;
  // Non-null after a failed createNew() call; cleared on the next query
  // change or successful create.
  createError: string | null;
  createNew: () => void;
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
  // Opt-in "Create <query>" affordance for a Chamber whose own exhibits can
  // be quick-created from here (only Notes, today) - resolves to the newly
  // created Exhibit (inserted exactly like a picked search result) or
  // rejects with a message to surface as `createError` (e.g. a title
  // conflict).
  onCreate?: (title: string) => Promise<CapitolExhibitSearchResult>;
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
export function useExhibitPicker({ value, onChange, onCreate }: UseExhibitPickerOptions): ExhibitPickerState {
  const [element, setElement] = useState<PickerElement | null>(null);
  const attachRef = useCallback((el: PickerElement | null) => setElement(el), []);

  const [trigger, setTrigger] = useState<TriggerState | null>(null);
  const [caretPosition, setCaretPosition] = useState<{ top: number; left: number } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Bumped by caret-only movements (click / arrow keys / selection changes),
  // which don't alter `value` but can still open or close the picker.
  const [caretTick, setCaretTick] = useState(0);
  const bumpCaret = useCallback(() => setCaretTick((t) => t + 1), []);

  const { results, loading } = useExhibitSearch(trigger?.query ?? "", trigger !== null);

  const query = trigger?.query ?? "";
  const trimmedQuery = query.trim();
  const showCreate =
    Boolean(onCreate) &&
    trimmedQuery.length > 0 &&
    !results.some((r) => r.name.toLowerCase() === trimmedQuery.toLowerCase());

  const triggerRef = useRef(trigger);
  triggerRef.current = trigger;
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const showCreateRef = useRef(showCreate);
  showCreateRef.current = showCreate;

  useEffect(() => {
    setActiveIndex(0);
    setCreateError(null);
  }, [trigger?.query]);

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
  }, [element, value, caretTick]);

  // The "[[" anchor's own position never moves while the query after it
  // keeps changing, so this only needs to re-measure (a mirror-div layout
  // read - see getCaretCoordinates) when triggerStart itself changes: a new
  // trigger opening, or the caret jumping to a different existing one. The
  // effect above used to also drive this measurement, re-running it on
  // every keystroke of the query even though the anchor itself hadn't
  // moved.
  const triggerStart = trigger?.triggerStart ?? null;
  useEffect(() => {
    if (!element || triggerStart === null || !(element instanceof HTMLTextAreaElement)) {
      setCaretPosition(null);
      return;
    }
    const coords = getCaretCoordinates(element, triggerStart);
    const lineHeight = parseFloat(window.getComputedStyle(element).lineHeight);
    setCaretPosition({ top: coords.top + (Number.isFinite(lineHeight) ? lineHeight : 20), left: coords.left });
  }, [element, triggerStart]);

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

  const createNew = useCallback(() => {
    const current = triggerRef.current;
    if (!onCreate || !current) return;
    const title = current.query.trim();
    if (!title) return;
    setCreating(true);
    setCreateError(null);
    onCreate(title)
      .then((result) => selectRef.current(result))
      .catch((err) => setCreateError(err instanceof Error ? err.message : "Failed to create"))
      .finally(() => setCreating(false));
  }, [onCreate]);
  const createNewRef = useRef(createNew);
  createNewRef.current = createNew;

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<PickerElement>) => {
      if (!triggerRef.current) return;

      if (e.key === "Escape") {
        e.preventDefault();
        setTrigger(null);
        return;
      }

      const currentResults = resultsRef.current;
      const total = currentResults.length + (showCreateRef.current ? 1 : 0);
      if (total === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % total);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + total) % total);
      } else if (e.key === "Enter") {
        const index = activeIndexRef.current;
        if (index < currentResults.length) {
          const active = currentResults[index];
          if (active) {
            e.preventDefault();
            selectRef.current(active);
          }
        } else if (showCreateRef.current) {
          e.preventDefault();
          createNewRef.current();
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
    showCreate,
    creating,
    createError,
    createNew,
    caretPosition,
    fieldProps: { ref: attachRef, onKeyDown, onSelect: bumpCaret, onClick: bumpCaret },
  };
}
