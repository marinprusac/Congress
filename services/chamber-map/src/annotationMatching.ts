// The time-span matching a history rebuild uses to decide where an
// owner-authored annotation should land once the visits and trips it was
// attached to have been deleted and regenerated (see reprocess.ts). A leaf
// module with no DB or state, in the same spirit as geo.ts: this is the one
// piece of the rebuild that can silently lose something the owner typed, so
// it is worth being able to reason about - and test - on its own.

export interface Span {
  start: number;
  end: number;
}

// How much of the annotated stretch the replacement has to actually cover
// before an annotation is moved onto it. Without a floor, any incidental
// sliver of overlap would do, and an annotation could migrate onto a
// neighbouring stretch that merely abuts the one it described.
export const MIN_OVERLAP_RATIO = 0.5;

export function overlapMs(a: Span, b: Span): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

// Overlap, but only once it clears MIN_OVERLAP_RATIO of the saved span - 0
// meaning "not the same stretch, don't move the annotation here". A
// zero-length saved span has no ratio to take, so any overlap counts.
export function claimStrength(saved: Span, candidate: Span): number {
  const overlap = overlapMs(saved, candidate);
  if (overlap <= 0) return 0;
  const savedLength = saved.end - saved.start;
  if (savedLength <= 0) return overlap;
  return overlap / savedLength >= MIN_OVERLAP_RATIO ? overlap : 0;
}
