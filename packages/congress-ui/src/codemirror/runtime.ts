import type { ReactNode } from "react";
import type { CapitolExhibitResolveResult } from "@congress/shared-types";

// Data an editor instance's CM6 extensions need to read at decoration/click
// time, but that changes on every React render (callback identity,
// freshly-resolved chip data). Extensions are built once per editor mount
// (see useExhibitEditorCore) and never reconstructed on a prop change - that
// would tear down undo history and cursor position - so they close over one
// of these ref objects instead, whose *fields* get mutated in place on every
// render (never `ref.current = newObject`), the same "always read the
// latest value through a stable ref" pattern NoteViewPage already uses for
// its draftTitle/draftContent refs.
export interface ExhibitEditorRuntimeData {
  renderIcon?: (chamber: string) => ReactNode;
  onNavigate?: (result: Extract<CapitolExhibitResolveResult, { url: string }>) => void;
  resultsByToken: Map<string, CapitolExhibitResolveResult>;
}

export interface ExhibitEditorRuntimeRef {
  current: ExhibitEditorRuntimeData;
}
