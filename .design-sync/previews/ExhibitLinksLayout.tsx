import { ExhibitLinksLayout, getChamberIcon } from "@congress/congress-ui";

export function NoteWithLinks() {
  return (
    <ExhibitLinksLayout
      exhibitId="note-9"
      emptyBacklinksLabel="Nothing references this note"
      emptyFrontlinksLabel="This note references nothing"
      renderIcon={getChamberIcon}
      onNavigate={() => {}}
    >
      <article>
        <h2 className="mb-4 font-display text-3xl text-ink">Congress Development</h2>
        <p className="font-mono text-base text-ink">
          Capitol is the central orchestrator: module registry, request gateway, homepage, cross-cutting
          settings, global search, and Exhibit Sharing. Each Chamber is a fully separate process with its
          own port, SQLite file, frontend build, and MCP server — no Chamber imports another Chamber's
          source or shares a database.
        </p>
        <p className="mt-4 font-mono text-base text-ink">
          The Exhibit system is the one piece of real cross-cutting product logic: every Chamber implements
          a small content contract so notes, tasks, documents, and calendar events can all reference each
          other through <code>[[exhibit:chamber:id|Label]]</code> tokens.
        </p>
      </article>
    </ExhibitLinksLayout>
  );
}

export function ShortNoteWithLinks() {
  return (
    <ExhibitLinksLayout
      exhibitId="note-9"
      emptyBacklinksLabel="Nothing references this note"
      emptyFrontlinksLabel="This note references nothing"
      renderIcon={getChamberIcon}
      onNavigate={() => {}}
    >
      <article>
        <h2 className="mb-4 font-display text-3xl text-ink">Weekly Standup</h2>
        <p className="font-mono text-base text-ink">Follow up on deploy timing and the icon set review.</p>
      </article>
    </ExhibitLinksLayout>
  );
}
