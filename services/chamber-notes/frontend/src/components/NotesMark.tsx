import type { SVGProps } from "react";

// Sourced from "35 Abstract Shape Icons" by Stockslord.com, recolored to
// currentColor. Kept in sync with the mark Capitol renders for this Chamber
// at services/capitol/frontend/src/components/icons.tsx. Notes' signature
// feature is wiki-links and backlinks, so the mark is two shapes
// overlapping — the intersection itself, not a page or a pen.
export function NotesMark(props: Omit<SVGProps<SVGSVGElement>, "viewBox" | "fill">) {
  return (
    <svg viewBox="0 0 256 256" fill="currentColor" {...props}>
      <g transform="translate(1.4065934065934016 1.4065934065934016) scale(2.81 2.81)">
        <path d="M 89.414 43.586 L 63.425 17.597 c -0.781 -0.781 -2.047 -0.781 -2.828 0 L 50.198 27.995 c -5.12 -6.672 -13.169 -10.984 -22.21 -10.984 C 12.556 17.011 0 29.567 0 45 c 0 15.434 12.556 27.989 27.989 27.989 c 9.041 0 17.089 -4.313 22.21 -10.984 l 10.398 10.398 c 0.375 0.375 0.884 0.586 1.414 0.586 s 1.039 -0.211 1.414 -0.586 l 25.989 -25.989 C 89.789 46.039 90 45.53 90 45 S 89.789 43.961 89.414 43.586 z M 27.989 68.989 C 14.761 68.989 4 58.228 4 45 s 10.761 -23.989 23.989 -23.989 c 7.939 0 14.986 3.879 19.355 9.839 L 34.608 43.586 c -0.781 0.781 -0.781 2.047 0 2.828 L 47.344 59.15 C 42.975 65.11 35.928 68.989 27.989 68.989 z M 51.978 45 c 0 3.817 -0.901 7.427 -2.494 10.634 L 38.851 45 l 10.633 -10.633 C 51.077 37.574 51.978 41.183 51.978 45 z M 62.011 68.161 l -9.568 -9.568 c 2.248 -4.028 3.534 -8.662 3.534 -13.593 c 0 -4.931 -1.286 -9.565 -3.534 -13.593 l 9.567 -9.567 L 85.172 45 L 62.011 68.161 z" />
      </g>
    </svg>
  );
}
