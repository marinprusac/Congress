import type { ReactElement, SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "viewBox" | "fill">;

// Duplicated from services/capitol/frontend/src/components/icons.tsx -
// Exhibit chips rendered here point at other Chambers' Exhibits, so this
// frontend needs its own copy of each Chamber's mark to render its icon
// (same precedent as Layout.tsx/wikilinks.ts already being duplicated
// per-Chamber-frontend in this codebase). Keep in sync when a new Chamber's
// mark is added to Capitol's copy.
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
      <path d="M 88 0 H 2 C 0.896 0 0 0.896 0 2 v 71 c 0 1.104 0.896 2 2 2 h 71 c 1.104 0 2 -0.896 2 -2 V 17 c 0 -1.104 -0.896 -2 -2 -2 H 17 c -1.104 0 -2 0.896 -2 2 v 41 c 0 1.104 0.896 2 2 2 h 41 c 1.104 0 2 -0.896 2 -2 V 32 c 0 -1.104 -0.896 -2 -2 -2 H 32 c -1.104 0 -2 0.896 -2 2 v 13 c 0 1.104 0.896 2 2 2 s 2 -0.896 2 -2 V 34 h 22 v 22 H 19 V 19 h 52 v 52 H 4 V 4 h 82 v 82 H 2 c -1.104 0 -2 0.896 -2 2 s 0.896 2 2 2 h 86 c 1.104 0 2 -0.896 2 -2 V 2 C 90 0.896 89.104 0 88 0 z" />
      </g>
    </svg>
  );
}

function DocumentsMark(props: IconProps) {
  return (
    <svg viewBox="0 0 256 256" fill="currentColor" {...props}>
      <g transform={GROUP_TRANSFORM}>
      <path d="M 30.459 4.618 C 15.869 4.618 4 16.49 4 31.083 c 0 1.104 -0.896 2 -2 2 s -2 -0.896 -2 -2 C 0 14.285 13.664 0.618 30.459 0.618 c 16.794 0 30.458 13.667 30.458 30.465 v 25.751 c 13.661 -1.026 24.465 -12.459 24.465 -26.375 C 85.382 15.869 73.51 4 58.917 4 c -1.104 0 -2 -0.896 -2 -2 s 0.896 -2 2 -2 c 16.798 0 30.465 13.664 30.465 30.458 c 0 16.794 -13.667 30.458 -30.465 30.458 H 33.166 c 1.026 13.661 12.459 24.465 26.375 24.465 C 74.131 85.382 86 73.51 86 58.917 c 0 -1.104 0.896 -2 2 -2 s 2 0.896 2 2 c 0 16.799 -13.664 30.465 -30.458 30.465 c -16.794 0 -30.458 -13.666 -30.458 -30.465 V 33.166 C 15.422 34.193 4.618 45.625 4.618 59.541 C 4.618 74.131 16.49 86 31.083 86 c 1.104 0 2 0.896 2 2 s -0.896 2 -2 2 C 14.284 90 0.618 76.336 0.618 59.541 c 0 -16.794 13.666 -30.458 30.465 -30.458 h 25.751 C 55.807 15.422 44.375 4.618 30.459 4.618 z M 33.083 56.917 h 23.834 V 33.083 H 33.083 V 56.917 z" />
      </g>
    </svg>
  );
}

const CHAMBER_MARKS: Record<string, (props: IconProps) => ReactElement> = {
  notes: NotesMark,
  calendar: CalendarMark,
  documents: DocumentsMark,
};

// Returns null for an unrecognized Chamber so callers fall back to the
// spec's designed text-prefix state instead of a broken icon.
export function getChamberIcon(chamber: string, props?: IconProps): ReactElement | null {
  const Mark = CHAMBER_MARKS[chamber];
  return Mark ? <Mark {...props} /> : null;
}
