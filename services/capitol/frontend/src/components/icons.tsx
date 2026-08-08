import { Orbit, Link2, Shapes, type LucideProps } from "lucide-react";

type IconProps = Omit<LucideProps, "strokeWidth">;

// Capitol's own mark: a central body with orbiting satellites — Capitol as
// the hub Chambers register and orbit around.
export function CapitolMark(props: IconProps) {
  return <Orbit strokeWidth={1.5} {...props} />;
}

// Notes: a link — its signature feature is wiki-links and backlinks between
// notes, so the mark is the connection itself, not a page or a pen.
function NotesMark(props: IconProps) {
  return <Link2 strokeWidth={1.5} {...props} />;
}

// Fallback for any Chamber without a dedicated mark yet.
function DefaultChamberMark(props: IconProps) {
  return <Shapes strokeWidth={1.5} {...props} />;
}

const CHAMBER_MARKS: Record<string, (props: IconProps) => ReturnType<typeof Orbit>> = {
  notes: NotesMark,
};

export function ChamberMark({ name, ...props }: IconProps & { name: string }) {
  const Mark = CHAMBER_MARKS[name] ?? DefaultChamberMark;
  return <Mark {...props} />;
}
