import type { ReactElement, SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "viewBox" | "fill" | "stroke">;

const base: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.25,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

// Capitol's own mark: a colonnade — pillars beneath a lintel, abstracted to
// straight strokes only.
export function CapitolMark(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="6" y1="7" x2="6" y2="19" />
      <line x1="12" y1="7" x2="12" y2="19" />
      <line x1="18" y1="7" x2="18" y2="19" />
      <line x1="4" y1="19" x2="20" y2="19" />
    </svg>
  );
}

// Notes: a page with a folded corner and two text rules.
function NotesMark(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <polygon points="6,4 15,4 19,8 19,20 6,20" />
      <polyline points="15,4 15,8 19,8" />
      <line x1="9" y1="12" x2="16" y2="12" />
      <line x1="9" y1="15.5" x2="16" y2="15.5" />
    </svg>
  );
}

// Fallback for any Chamber without a dedicated mark yet.
function DefaultChamberMark(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <polygon points="12,4 20,12 12,20 4,12" />
    </svg>
  );
}

const CHAMBER_MARKS: Record<string, (props: IconProps) => ReactElement> = {
  notes: NotesMark,
};

export function ChamberMark({ name, ...props }: IconProps & { name: string }) {
  const Mark = CHAMBER_MARKS[name] ?? DefaultChamberMark;
  return <Mark {...props} />;
}
