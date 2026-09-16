export type EditorIdentityAction = "keep" | "reset";

// A create/edit page that stays mounted across the create -> persisted
// transition (see useDraftCreate) also stays mounted across a navigation
// from one persisted id straight to a different one (e.g. an Exhibit chip
// pointing at a sibling note/task/directive) - same component type at the
// same route position, so React doesn't remount and re-run initializer
// state on its own. This tells the two apart: `idParam` matching
// `currentId` means the URL just caught up with this page's own
// `navigate(..., { replace: true })` right after a create (keep local
// draft state as-is); anything else means the *user* navigated to a
// genuinely different id (or back to the draft/"new" route) and local
// draft state must be reset from scratch.
export function resolveEditorIdentity<T>(idParam: T | null, currentId: T | null): EditorIdentityAction {
  return idParam === currentId ? "keep" : "reset";
}
