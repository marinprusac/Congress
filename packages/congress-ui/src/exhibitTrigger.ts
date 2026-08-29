import { buildExhibitToken } from "./token.js";

export interface ExhibitTriggerMatch {
  // Index of the "@" character itself, not the character after it.
  triggerStart: number;
  // Everything typed since "@", not including it - may contain spaces (per
  // spec, a space does not close the picker, only a newline or Escape does).
  query: string;
}

// Detects a live "@" reference trigger ending at `cursor`, framework-agnostic
// so it's usable from both a CM6 ViewPlugin and a unit test with no DOM.
//
// Fires only when "@" is at the very start of the field or immediately
// preceded by whitespace - "foo@bar" never triggers, "foo @bar" does. Once
// triggered, the query keeps accumulating through embedded spaces; only a
// newline since the "@" closes it (mirroring the old "[[" picker's "]]" or
// newline closes it rule - Escape is a separate, caller-driven close, not
// modeled here since it isn't a property of the text/cursor alone).
export function detectExhibitTrigger(text: string, cursor: number): ExhibitTriggerMatch | null {
  const beforeCursor = text.slice(0, cursor);
  const triggerStart = beforeCursor.lastIndexOf("@");
  if (triggerStart === -1) return null;

  const precedingChar = triggerStart === 0 ? null : (text[triggerStart - 1] ?? null);
  if (precedingChar !== null && !/\s/.test(precedingChar)) return null;

  const query = beforeCursor.slice(triggerStart + 1);
  if (query.includes("\n")) return null;

  return { triggerStart, query };
}

export interface ExhibitChipInsertion {
  // The literal "[[exhibit:chamber:id|name]]" text to splice in.
  text: string;
  // The [from, to) range it replaces - `from` is the trigger's "@", `to` is
  // the cursor position at selection time (the end of the live query).
  from: number;
  to: number;
}

// Builds the literal chip-token replacement for a picked search result -
// same underlying "[[exhibit:chamber:id|Label]]" string the old "[[" picker
// produced, just triggered and spliced differently. The stored/wire format
// is unchanged; only the editing surface that produces and displays it is.
export function buildChipInsertion(params: {
  triggerStart: number;
  cursor: number;
  chamber: string;
  id: string;
  name: string;
}): ExhibitChipInsertion {
  const token = buildExhibitToken({ chamber: params.chamber, id: params.id });
  return { text: `[[${token}|${params.name}]]`, from: params.triggerStart, to: params.cursor };
}
