import type { SVGProps } from "react";

// A page with a folded corner and two text rules — kept in sync with the
// mark Capitol renders for this Chamber at services/capitol/frontend/src/components/icons.tsx.
export function NotesMark(props: Omit<SVGProps<SVGSVGElement>, "viewBox" | "fill" | "stroke">) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <polygon points="6,4 15,4 19,8 19,20 6,20" />
      <polyline points="15,4 15,8 19,8" />
      <line x1="9" y1="12" x2="16" y2="12" />
      <line x1="9" y1="15.5" x2="16" y2="15.5" />
    </svg>
  );
}
