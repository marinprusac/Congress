import type { SVGProps } from "react";

// Placeholder mark — reuses Capitol's neutral fallback diamond until a
// dedicated shape is hand-picked from the licensed abstract icon pack, same
// as Notes' mark was. Kept in sync with the mark Capitol renders for this
// Chamber at services/capitol/frontend/src/components/icons.tsx.
export function CalendarMark(props: Omit<SVGProps<SVGSVGElement>, "viewBox" | "fill">) {
  return (
    <svg viewBox="0 0 256 256" fill="currentColor" {...props}>
      <g transform="translate(1.4065934065934016 1.4065934065934016) scale(2.81 2.81)">
        <path d="M 89.414 43.586 l -43 -43 c -0.781 -0.781 -2.048 -0.781 -2.828 0 l -43 43 c -0.781 0.781 -0.781 2.047 0 2.828 l 43 43 C 43.976 89.805 44.488 90 45 90 s 1.023 -0.195 1.414 -0.586 l 43 -43 C 90.195 45.633 90.195 44.367 89.414 43.586 z M 45 4.829 l 18.616 18.616 c -10.646 9.253 -26.588 9.253 -37.233 0 L 45 4.829 z M 58.575 31.425 c -3.952 8.589 -3.951 18.562 0 27.151 c -8.588 -3.951 -18.562 -3.952 -27.151 -0.001 c 3.952 -8.589 3.952 -18.562 0 -27.15 c 4.294 1.976 8.934 2.966 13.575 2.966 C 49.641 34.391 54.281 33.401 58.575 31.425 z M 23.445 26.384 c 9.253 10.646 9.253 26.587 0 37.233 L 4.829 45 L 23.445 26.384 z M 45 85.172 L 26.384 66.555 c 10.646 -9.252 26.587 -9.252 37.233 0 L 45 85.172 z M 66.555 63.617 c -9.253 -10.646 -9.253 -26.587 0 -37.233 L 85.172 45 L 66.555 63.617 z" />
      </g>
    </svg>
  );
}
