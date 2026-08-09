import type { SVGProps } from "react";

// Placeholder mark — swap for a hand-picked shape from the licensed abstract
// icon pack, same as Notes' mark was. Kept in sync with the mark Capitol
// renders for this Chamber at services/capitol/frontend/src/components/icons.tsx.
export function CalendarMark(props: Omit<SVGProps<SVGSVGElement>, "viewBox" | "fill">) {
  return (
    <svg viewBox="0 0 256 256" fill="currentColor" {...props}>
      <g transform="translate(1.4065934065934016 1.4065934065934016) scale(2.81 2.81)">
        <path d="M 45 5 L 85 45 L 45 85 L 5 45 Z M 45 20 L 60 45 L 45 70 L 30 45 Z" />
      </g>
    </svg>
  );
}
