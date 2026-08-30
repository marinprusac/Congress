import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ExhibitFieldEditor,
  ExhibitActionBar,
  ExhibitLinksLayout,
  navigateToExhibit,
  getChamberIcon,
  useShellHosted,
  resolveChamberPath,
  flushDraftConnections,
  FormErrorMessage,
} from "@congress/congress-ui";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";
import { createNote, quickCreateNoteExhibit } from "@/lib/api";

// Deliberately the same shape as NoteViewPage's editing state (title input,
// ExhibitTextarea, ExhibitLinksLayout with a live Connections panel) rather
// than a plain form - a new note is just an existing note whose id doesn't
// exist yet. Connections picked here are staged in `draftConnections`
// (ExhibitLinksLayout's `exhibitId={null}` mode) and only actually written
// once the create mutation below hands them a real id to attach to.
export function NewNotePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(searchParams.get("title") ?? "");
  const [content, setContent] = useState("");
  const [draftConnections, setDraftConnections] = useState<CapitolExhibitSearchResult[]>([]);

  const mutation = useMutation({
    mutationFn: async () => {
      const created = await createNote({ title, content });
      await flushDraftConnections(`note-${created.id}`, draftConnections);
      return created;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      navigate(resolveChamberPath(`/n/${created.id}`, "notes", shellHosted));
    },
  });

  async function onCreateExhibit(refTitle: string) {
    const result = await quickCreateNoteExhibit(refTitle);
    queryClient.invalidateQueries({ queryKey: ["notes"] });
    return result;
  }

  return (
    <article>
      <div className="mb-6 border-b border-dust pb-4">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="w-full font-display text-3xl text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>

      {mutation.isError && <FormErrorMessage>{(mutation.error as Error).message}</FormErrorMessage>}

      <ExhibitLinksLayout
        exhibitId={null}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("notes", r, navigate, shellHosted)}
        editable
        onCreateReference={onCreateExhibit}
        draftConnections={draftConnections}
        onDraftConnectionsChange={setDraftConnections}
        actions={
          <ExhibitActionBar>
            <button
              onClick={() => title.trim() && mutation.mutate()}
              disabled={!title.trim() || mutation.isPending}
              className="tap-target text-accent hover:underline disabled:opacity-50"
            >
              {mutation.isPending ? "Creating —" : "Create"}
            </button>
            <button
              onClick={() => navigate(resolveChamberPath("/", "notes", shellHosted))}
              className="tap-target text-slate hover:underline"
            >
              Cancel
            </button>
          </ExhibitActionBar>
        }
      >
        <ExhibitFieldEditor
          value={content}
          onChange={setContent}
          minRows={20}
          placeholder={"---\ntags: []\n---\nStart writing. Type @ to reference a note, event, or other Exhibit."}
          className="w-full bg-parchment p-3 font-body text-base text-ink focus-within:outline-none"
          renderIcon={(chamber) => getChamberIcon(chamber)}
          onCreate={onCreateExhibit}
        />
      </ExhibitLinksLayout>
    </article>
  );
}
