import type { ReactElement, SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "viewBox" | "fill">;

// Duplicated from services/chamber-notes/frontend/src/components/ChamberIcon.tsx
// (itself duplicated from services/capitol/frontend/src/components/icons.tsx) -
// Exhibit chips rendered here point at other Chambers' Exhibits, so this
// frontend needs its own copy of each Chamber's mark to render its icon.
// Keep in sync when a new Chamber's mark is added elsewhere.
const GROUP_TRANSFORM = "translate(1.4065934065934016 1.4065934065934016) scale(2.81 2.81)";

function NotesMark(props: IconProps) {
  return (
    <svg viewBox="0 0 256 256" fill="currentColor" {...props}>
      <g transform={GROUP_TRANSFORM}>
      <path d="M 89.414 43.586 L 63.425 17.597 c -0.781 -0.781 -2.047 -0.781 -2.828 0 L 50.198 27.995 c -5.12 -6.672 -13.169 -10.984 -22.21 -10.984 C 12.556 17.011 0 29.567 0 45 c 0 15.434 12.556 27.989 27.989 27.989 c 9.041 0 17.089 -4.313 22.21 -10.984 l 10.398 10.398 c 0.375 0.375 0.884 0.586 1.414 0.586 s 1.039 -0.211 1.414 -0.586 l 25.989 -25.989 C 89.789 46.039 90 45.53 90 45 S 89.789 43.961 89.414 43.586 z M 27.989 68.989 C 14.761 68.989 4 58.228 4 45 s 10.761 -23.989 23.989 -23.989 c 7.939 0 14.986 3.879 19.355 9.839 L 34.608 43.586 c -0.781 0.781 -0.781 2.047 0 2.828 L 47.344 59.15 C 42.975 65.11 35.928 68.989 27.989 68.989 z M 51.978 45 c 0 3.817 -0.901 7.427 -2.494 10.634 L 38.851 45 l 10.633 -10.633 C 51.077 37.574 51.978 41.183 51.978 45 z M 62.011 68.161 l -9.568 -9.568 c 2.248 -4.028 3.534 -8.662 3.534 -13.593 c 0 -4.931 -1.286 -9.565 -3.534 -13.593 l 9.567 -9.567 L 85.172 45 L 62.011 68.161 z" />
      </g>
    </svg>
  );
}

function CalendarMark(props: IconProps) {
  return (
    <svg viewBox="0 0 256 256" fill="currentColor" {...props}>
      <g transform={GROUP_TRANSFORM}>
      <path d="M 89.414 43.586 l -43 -43 c -0.781 -0.781 -2.048 -0.781 -2.828 0 l -43 43 c -0.781 0.781 -0.781 2.047 0 2.828 l 43 43 C 43.976 89.805 44.488 90 45 90 s 1.023 -0.195 1.414 -0.586 l 43 -43 C 90.195 45.633 90.195 44.367 89.414 43.586 z M 45 4.829 l 18.616 18.616 c -10.646 9.253 -26.588 9.253 -37.233 0 L 45 4.829 z M 58.575 31.425 c -3.952 8.589 -3.951 18.562 0 27.151 c -8.588 -3.951 -18.562 -3.952 -27.151 -0.001 c 3.952 -8.589 3.952 -18.562 0 -27.15 c 4.294 1.976 8.934 2.966 13.575 2.966 C 49.641 34.391 54.281 33.401 58.575 31.425 z M 23.445 26.384 c 9.253 10.646 9.253 26.587 0 37.233 L 4.829 45 L 23.445 26.384 z M 45 85.172 L 26.384 66.555 c 10.646 -9.252 26.587 -9.252 37.233 0 L 45 85.172 z M 66.555 63.617 c -9.253 -10.646 -9.253 -26.587 0 -37.233 L 85.172 45 L 66.555 63.617 z" />
      </g>
    </svg>
  );
}

const CHAMBER_MARKS: Record<string, (props: IconProps) => ReactElement> = {
  notes: NotesMark,
  calendar: CalendarMark,
};

// Returns null for an unrecognized Chamber so callers fall back to the
// spec's designed text-prefix state instead of a broken icon.
export function getChamberIcon(chamber: string, props?: IconProps): ReactElement | null {
  const Mark = CHAMBER_MARKS[chamber];
  return Mark ? <Mark {...props} /> : null;
}
