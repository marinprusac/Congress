// Shared phrasing for home-feed reasons ("Starts in 25 min", "Overdue by
// 2 h"), so every Chamber's feed candidates read the same way. Rounded
// coarsely on purpose - the feed is a glance, not a countdown.
export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} days`;
}

// A note/description body flattened for a feed item's inline preview:
// "[[exhibit:notes:note-4|Trip plan]]" chips become their label,
// markdown markers (headings, emphasis, list bullets, quotes, code ticks)
// and extra whitespace go, and it's cut at a word boundary. Returns
// undefined for an empty body so the preview simply omits it.
export function plainTextPreview(text: string | null | undefined, maxLength = 240): string | undefined {
  if (!text) return undefined;
  const plain = text
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|[-*+]|>|\d+\.)\s+/gm, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return undefined;
  if (plain.length <= maxLength) return plain;
  const cut = plain.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

// Linear 0..1 closeness of `ms` to zero within `windowMs` (1 = now, 0 = at
// or past the window edge) - for scaling a candidate's score by how soon
// something happens.
export function closeness(ms: number, windowMs: number): number {
  if (ms <= 0) return 1;
  if (ms >= windowMs) return 0;
  return 1 - ms / windowMs;
}
