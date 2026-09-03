import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExtension } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import type { CapitolExhibitResolveResult, CapitolExhibitSearchResult } from "@congress/shared-types";
import { useExhibitSearch } from "../useExhibitSearch.js";
import { extractExhibitTokens } from "../textSegments.js";
import { useResolvedExhibits } from "../useResolvedExhibits.js";
import type { ExhibitPickerState } from "../ExhibitPickerDropdown.js";
import { buildChipInsertion } from "../exhibitTrigger.js";
import { createExhibitChipExtensions, refreshExhibitChips } from "./exhibitChipDecorations.js";
import { createExhibitTriggerExtension, type ExhibitPickerController } from "./exhibitTriggerExtension.js";
import type { ExhibitEditorRuntimeRef } from "./runtime.js";
import { exhibitEditorTheme, markdownHighlightStyle } from "./theme.js";
import { createLivePreviewExtension } from "./livePreviewExtension.js";
import { createSingleLineExtension } from "./singleLineExtension.js";

export interface UseExhibitEditorCoreOptions {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  mode: "multiline" | "inline";
  renderIcon: (chamber: string) => ReactNode;
  onNavigate?: (result: Extract<CapitolExhibitResolveResult, { url: string }>) => void;
  onCreate?: (title: string) => Promise<CapitolExhibitSearchResult>;
  onEnter?: () => void;
  autoFocus?: boolean;
}

interface TriggerState {
  triggerStart: number;
  query: string;
  cursor: number;
}

// Shared core behind <ExhibitFieldEditor> (multiline) and <ExhibitInlineField>
// (single-line) - owns the CM6 EditorView lifecycle, the "@" picker's
// search/keyboard-nav state, and resolving exhibit tokens for the chip
// decorations. Returns a plain DOM ref to mount CM6 into and a picker object
// satisfying ExhibitPickerDropdown.tsx's own ExhibitPickerState contract, so
// the existing, already mobile-verified <ExhibitPickerDropdown> keeps
// working completely unmodified.
export function useExhibitEditorCore(options: UseExhibitEditorCoreOptions): {
  containerRef: (el: HTMLDivElement | null) => void;
  picker: ExhibitPickerState;
} {
  const { value, onChange, readOnly = false, placeholder, mode, renderIcon, onNavigate, onCreate, onEnter, autoFocus } = options;

  const containerElRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onEnterRef = useRef(onEnter);
  onEnterRef.current = onEnter;
  const valueRef = useRef(value);
  valueRef.current = value;

  const [trigger, setTrigger] = useState<TriggerState | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const { results, loading } = useExhibitSearch(trigger?.query ?? "", trigger !== null && !readOnly);

  // The "@" anchor's own position only *changes* (a real DOM layout read,
  // via CM6's own coordsAtPos) when triggerStart itself changes - a new
  // trigger opening, or the caret jumping to a different existing one -
  // mirroring the old useExhibitPicker's identical optimization; a re-
  // measure on plain scroll/resize below is cheap in comparison and keeps
  // the dropdown honest about where the caret currently sits on screen
  // while it stays open through either. This must run outside CM6's own
  // update cycle (a plain React effect, not from inside the trigger-
  // detection ViewPlugin) - CM6 throws if layout is read synchronously from
  // inside a ViewPlugin's update(). Client/viewport coordinates (exactly
  // what coordsAtPos already returns - CM6 doesn't offset these to the
  // editor's own DOM node), not editor-relative ones: ExhibitPickerDropdown
  // positions itself with `position: fixed` against these directly, so it
  // can float freely above or below the caret's own line and clamp itself
  // against the real screen edges/keyboard, the same as any other viewport-
  // anchored overlay in this app.
  const triggerStart = trigger?.triggerStart ?? null;
  const [caretPosition, setCaretPosition] = useState<{ top: number; bottom: number; left: number } | null>(null);
  useEffect(() => {
    const view = viewRef.current;
    if (!view || triggerStart === null) {
      setCaretPosition(null);
      return;
    }
    function measure() {
      const coords = view!.coordsAtPos(triggerStart!);
      setCaretPosition(coords ? { top: coords.top, bottom: coords.bottom, left: coords.left } : null);
    }
    measure();
    // Capture phase so a scroll on any ancestor scroll container (not just
    // the window/document) is caught too.
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    // iOS Safari's keyboard/QuickType bar resizes and scrolls the *visual*
    // viewport without firing a `window` resize/scroll event, leaving a
    // stale caret position behind as you type. useKeyboardInset already
    // listens to these same visualViewport events for the other half of
    // the position math; this mirrors it.
    const vv = window.visualViewport;
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
    };
  }, [triggerStart]);

  const trimmedQuery = (trigger?.query ?? "").trim();
  const showCreate =
    Boolean(onCreate) && trimmedQuery.length > 0 && !results.some((r) => r.name.toLowerCase() === trimmedQuery.toLowerCase());

  // Read by the CM6 keymap (built once at mount) through a stable
  // controller object - see exhibitTriggerExtension.ts's own comment on why
  // extensions can't just close over React state directly.
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

  const select = useCallback((result: CapitolExhibitSearchResult) => {
    const current = triggerRef.current;
    const view = viewRef.current;
    if (!current || !view) return;
    const insertion = buildChipInsertion({
      triggerStart: current.triggerStart,
      cursor: current.cursor,
      chamber: result.chamber,
      id: result.id,
      name: result.name,
    });
    view.dispatch({
      changes: { from: insertion.from, to: insertion.to, insert: insertion.text },
      selection: { anchor: insertion.from + insertion.text.length },
    });
    view.focus();
    setTrigger(null);
  }, []);
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

  const controllerRef = useRef<ExhibitPickerController>({
    isOpen: () => false,
    onEscape: () => {},
    onArrowDown: () => {},
    onArrowUp: () => {},
    onSelectActive: () => {},
  });
  controllerRef.current.isOpen = () => triggerRef.current !== null;
  controllerRef.current.onEscape = () => setTrigger(null);
  controllerRef.current.onArrowDown = () => {
    const total = resultsRef.current.length + (showCreateRef.current ? 1 : 0);
    if (total === 0) return;
    setActiveIndex((i) => (i + 1) % total);
  };
  controllerRef.current.onArrowUp = () => {
    const total = resultsRef.current.length + (showCreateRef.current ? 1 : 0);
    if (total === 0) return;
    setActiveIndex((i) => (i - 1 + total) % total);
  };
  controllerRef.current.onSelectActive = () => {
    const index = activeIndexRef.current;
    const currentResults = resultsRef.current;
    if (index < currentResults.length) {
      const active = currentResults[index];
      if (active) selectRef.current(active);
    } else if (showCreateRef.current) {
      createNewRef.current();
    }
  };

  // Chip rendering data - same shape/resolution mechanism ExhibitAnnotatedText
  // and ExhibitMarkdown already use.
  const tokens = extractExhibitTokens(value);
  const { resultsByToken } = useResolvedExhibits(tokens);
  const runtimeRef = useRef<ExhibitEditorRuntimeRef>({ current: { renderIcon, onNavigate, resultsByToken } });
  runtimeRef.current.current.renderIcon = renderIcon;
  runtimeRef.current.current.onNavigate = onNavigate;
  runtimeRef.current.current.resultsByToken = resultsByToken;

  useEffect(() => {
    if (tokens.length === 0) return;
    viewRef.current?.dispatch({ effects: refreshExhibitChips.of(null) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultsByToken]);

  const containerRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      containerElRef.current = el;

      const extensions: Extension[] = [
        history(),
        markdown(),
        markdownHighlightStyle,
        createLivePreviewExtension(mode),
        exhibitEditorTheme,
        EditorView.lineWrapping,
        ...createExhibitChipExtensions(runtimeRef.current),
        ...createExhibitTriggerExtension({
          enabled: !readOnly,
          onTriggerChange: (report) => setTrigger(report),
          controller: controllerRef.current,
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ];
      if (mode === "inline") extensions.push(...createSingleLineExtension(() => onEnterRef.current?.()));
      // defaultKeymap/historyKeymap last, so the exhibit picker (Prec.highest)
      // and single-line Enter binding both take priority over their defaults
      // at the same precedence level.
      extensions.push(keymap.of([...defaultKeymap, ...historyKeymap]));
      if (placeholder) extensions.push(placeholderExtension(placeholder));

      const state = EditorState.create({ doc: valueRef.current, extensions });
      const view = new EditorView({ state, parent: el });
      viewRef.current = view;
      if (autoFocus) view.focus();

      // The wrapper div (`el`) can be visually taller than CM6's own content
      // (see `minRows` on <ExhibitFieldEditor>, e.g. a 20-row-tall empty
      // note) - CM6 itself only ever sizes to its actual content height, so
      // without this, clicking in that extra empty space below a short
      // body's last line would miss the editable surface entirely instead
      // of focusing it and placing the caret at the end, the way a plain
      // <textarea> naturally would.
      function onContainerClick(e: MouseEvent) {
        if (e.target !== el) return;
        view.focus();
        view.dispatch({ selection: { anchor: view.state.doc.length } });
      }
      el.addEventListener("click", onContainerClick);

      // React 19's ref-callback cleanup: runs both on true unmount and
      // whenever this callback's own identity changes (i.e. readOnly/mode
      // below), so a full teardown+recreate on either changing - rather
      // than a live reconfiguration - is enough and needs no separate
      // unmount effect.
      return () => {
        el.removeEventListener("click", onContainerClick);
        view.destroy();
        if (viewRef.current === view) viewRef.current = null;
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readOnly, mode]
  );

  // Pushes an externally-changed `value` (switching notes, a Cancel button
  // reverting a draft) into the live CM6 doc. Never fires from the editor's
  // own typing, since at that point `view.state.doc.toString() === value`
  // already (the parent's state update this effect depends on came from our
  // own onChange in the first place).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  }, [value]);

  const picker: ExhibitPickerState = {
    open: trigger !== null,
    query: trigger?.query ?? "",
    results,
    loading,
    activeIndex,
    setActiveIndex,
    select,
    showCreate,
    creating,
    createError,
    createNew,
    caretPosition,
  };

  return { containerRef, picker };
}
