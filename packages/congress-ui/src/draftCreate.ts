export type DraftCreateState = "idle" | "fired";

// Decides whether a draft-create attempt (e.g. leaving the title field, or
// unmounting with unsaved content) should actually fire the create - false
// once it has already fired once, so a duplicate blur/unmount can't create a
// second exhibit for the same draft.
export function shouldFireDraftCreate(state: DraftCreateState, canCreate: boolean): boolean {
  return state === "idle" && canCreate;
}
