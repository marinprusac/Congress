import { Link2, type LucideProps } from "lucide-react";

// A link — kept in sync with the mark Capitol renders for this Chamber at
// services/capitol/frontend/src/components/icons.tsx. Notes' signature
// feature is wiki-links and backlinks, so the mark is the connection
// itself, not a page or a pen.
export function NotesMark(props: Omit<LucideProps, "strokeWidth">) {
  return <Link2 strokeWidth={1.5} {...props} />;
}
