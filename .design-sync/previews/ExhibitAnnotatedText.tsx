import { ExhibitAnnotatedText, getChamberIcon } from "@congress/exhibit-ui";

const BODY =
  "See [[exhibit:notes:note-9|Congress Development]] for the full write-up, and " +
  "[[exhibit:tasks:task-1|Ship the Tasks Chamber]] tracks the rollout. An earlier draft, " +
  "[[exhibit:notes:note-99|Old draft]], was deleted, and " +
  "[[exhibit:documents:document-4|Design doc]] is temporarily unavailable.";

export function MixedReferences() {
  return <ExhibitAnnotatedText text={BODY} renderIcon={getChamberIcon} />;
}

export function PlainText() {
  return <ExhibitAnnotatedText text="A paragraph with no Exhibit references at all, rendered as-is." />;
}
