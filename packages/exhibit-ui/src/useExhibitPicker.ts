import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";
import { useExhibitSearch } from "./useExhibitSearch.js";
import { buildExhibitToken } from "./token.js";

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
}

// Detects "[[" typed immediately before the cursor (with no "]]" or newline
// since), tracking the query text as the user keeps typing, so a consumer
// can drive an <ExhibitPickerDropdown> off the returned state.
export function useExhibitPicker(
  textareaRef: RefObject<HTMLTextAreaElement | HTMLInputElement | null>,
  onInsert: (newValue: string, newCursor: number) => void
): ExhibitPickerState {
  const [trigger, setTrigger] = useState<TriggerState | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const { results, loading } = useExhibitSearch(trigger?.query ?? "");

  useEffect(() => setActiveIndex(0), [trigger?.query]);

  const close = useCallback(() => setTrigger(null), []);

  const select = useCallback(
    (result: CapitolExhibitSearchResult) => {
      const el = textareaRef.current;
      if (!el || !trigger) return;

      const token = buildExhibitToken({ chamber: result.chamber, id: result.id });
      const inserted = `[[${token}|${result.name}]]`;
      const value = el.value;
      const newValue = value.slice(0, trigger.triggerStart) + inserted + value.slice(trigger.cursor);
      const newCursor = trigger.triggerStart + inserted.length;

      onInsert(newValue, newCursor);
      setTrigger(null);

      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(newCursor, newCursor);
      });
    },
    [textareaRef, trigger, onInsert]
  );

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    function detectTrigger() {
      if (!el) return;
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
      if (!trigger) return;
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }

    el.addEventListener("input", detectTrigger);
    el.addEventListener("click", detectTrigger);
    el.addEventListener("keyup", detectTrigger);
    el.addEventListener("keydown", handleKeyDown as EventListener);
    return () => {
      el.removeEventListener("input", detectTrigger);
      el.removeEventListener("click", detectTrigger);
      el.removeEventListener("keyup", detectTrigger);
      el.removeEventListener("keydown", handleKeyDown as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textareaRef.current, trigger, close]);

  // Arrow/Enter navigation while the dropdown is open - registered
  // separately so it always sees the latest `results`/`activeIndex`.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || !trigger) return;

    function handleNavKeyDown(e: KeyboardEvent) {
      if (results.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % results.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + results.length) % results.length);
      } else if (e.key === "Enter") {
        const active = results[activeIndex];
        if (active) {
          e.preventDefault();
          select(active);
        }
      }
    }

    el.addEventListener("keydown", handleNavKeyDown as EventListener);
    return () => el.removeEventListener("keydown", handleNavKeyDown as EventListener);
  }, [textareaRef, trigger, results, activeIndex, select]);

  return {
    open: trigger !== null,
    query: trigger?.query ?? "",
    results,
    loading,
    activeIndex,
    setActiveIndex,
    select,
    close,
  };
}
