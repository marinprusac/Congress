import { WidgetPreviewShell } from "@congress/congress-ui";

// Real usage: embedded as a Chamber's homepage widget via an iframe (see
// WidgetGrid.tsx) — each Chamber's own WidgetPreviewPage.tsx supplies
// label/addHref/children. Ported here from
// services/chamber-notes/frontend/src/pages/WidgetPreviewPage.tsx, whose
// real fetch drives isLoading/isError/isEmpty against exactly these props.

const PINNED_NOTES = [
  { id: 9, title: "Congress Development" },
  { id: 5, title: "Needed Fixes" },
  { id: 2, title: "Reading List — Q3" },
];

export function Loading() {
  return (
    <WidgetPreviewShell
      label="Pinned"
      addHref="/notes/new"
      isLoading={true}
      isError={false}
      errorLabel="Notes unavailable."
      isEmpty={false}
      emptyLabel="— No pinned notes —"
    />
  );
}

export function ErrorState() {
  return (
    <WidgetPreviewShell
      label="Pinned"
      addHref="/notes/new"
      isLoading={false}
      isError={true}
      errorLabel="Notes unavailable."
      isEmpty={false}
      emptyLabel="— No pinned notes —"
    />
  );
}

export function EmptyState() {
  return (
    <WidgetPreviewShell
      label="Pinned"
      addHref="/notes/new"
      isLoading={false}
      isError={false}
      errorLabel="Notes unavailable."
      isEmpty={true}
      emptyLabel="— No pinned notes —"
    />
  );
}

export function Populated() {
  return (
    <WidgetPreviewShell
      label="Pinned"
      addHref="/notes/new"
      isLoading={false}
      isError={false}
      errorLabel="Notes unavailable."
      isEmpty={false}
      emptyLabel="— No pinned notes —"
    >
      {PINNED_NOTES.map((note) => (
        <a
          key={note.id}
          href={`/notes/n/${note.id}`}
          target="_top"
          className="block border-b border-dust py-1.5 font-display text-sm text-ink first:pt-0 last:border-b-0 hover:text-accent"
        >
          {note.title}
        </a>
      ))}
    </WidgetPreviewShell>
  );
}
