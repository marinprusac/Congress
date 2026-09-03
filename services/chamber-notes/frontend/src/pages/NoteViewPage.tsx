import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExhibitFieldEditor,
  ExhibitActionBar,
  ExhibitLinksLayout,
  navigateToExhibit,
  getChamberIcon,
  useShellHosted,
  resolveChamberPath,
  ConfirmSheet,
  showToast,
  useAutosave,
} from "@congress/congress-ui";
import { fetchNote, updateNote, deleteNote, setPinned, quickCreateNoteExhibit } from "@/lib/api";
import type { NoteSummary } from "../../../src/types";

export function NoteViewPage() {
  const { id } = useParams<{ id: string }>();
  const noteId = Number(id);
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");

  const noteQuery = useQuery({
    queryKey: ["note", noteId],
    queryFn: () => fetchNote(noteId),
    enabled: Number.isInteger(noteId),
  });

  const updateMutation = useMutation({
    mutationFn: (input: { title: string; content: string }) => updateNote(noteId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(["note", noteId], updated);
      // Keeps the home list's title/excerpt/pinned/updatedAt in sync live,
      // without the network round-trip a full invalidate would cost - an
      // autosave firing on every debounced edit would otherwise invalidate
      // ["notes"] outright, refetching every note's body just to redraw one
      // row's excerpt. A real resync still happens on unmount below.
      queryClient.setQueryData<NoteSummary[]>(["notes"], (list) =>
        list?.map((n) =>
          n.id === updated.id
            ? {
                ...n,
                title: updated.title,
                excerpt: updated.excerpt,
                pinned: updated.pinned,
                frontmatter: updated.frontmatter,
                updatedAt: updated.updatedAt,
              }
            : n
        )
      );
    },
  });

  // A real resync on leaving the page, even if every intermediate autosave
  // only patched the list cache in place above - covers drift the patch
  // can't (e.g. a field the patch doesn't carry, or another client's write).
  useEffect(() => {
    return () => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
    };
  }, [queryClient]);

  const deleteMutation = useMutation({
    mutationFn: () => deleteNote(noteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      navigate(resolveChamberPath("/", "notes", shellHosted));
      showToast("Note deleted");
    },
    onError: () => showToast("Failed to delete note.", "error"),
  });

  const pinMutation = useMutation({
    mutationFn: (pinned: boolean) => setPinned(noteId, pinned),
    onSuccess: (updated) => {
      queryClient.setQueryData(["note", noteId], updated);
      queryClient.invalidateQueries({ queryKey: ["notes"] });
    },
  });

  // Loads drafts from the server exactly once per note - a background
  // refetch of the same note (e.g. after a pin toggle) must never stomp
  // in-progress local edits, but navigating to a *different* note (a new
  // `noteId`, hence a fresh id on the fetched data) must reset them.
  const initializedNoteIdRef = useRef<number | null>(null);
  const { markSaved } = useAutosave({
    value: { title: draftTitle, content: draftContent },
    enabled: initializedNoteIdRef.current !== null,
    onSave: (draft) => updateMutation.mutate(draft),
  });
  useEffect(() => {
    if (noteQuery.data && initializedNoteIdRef.current !== noteQuery.data.id) {
      const draft = { title: noteQuery.data.title, content: noteQuery.data.content };
      setDraftTitle(draft.title);
      setDraftContent(draft.content);
      markSaved(draft);
      initializedNoteIdRef.current = noteQuery.data.id;
    }
  }, [noteQuery.data, markSaved]);

  async function onCreateExhibit(title: string) {
    const result = await quickCreateNoteExhibit(title);
    queryClient.invalidateQueries({ queryKey: ["notes"] });
    return result;
  }

  if (!Number.isInteger(noteId)) return <p className="font-mono text-sm text-alert">Invalid note id.</p>;
  if (noteQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (noteQuery.isError || !noteQuery.data)
    return <p className="font-mono text-sm text-alert">Note not found.</p>;

  const note = noteQuery.data;

  return (
    <article>
      <div className="mb-6 border-b border-dust pb-4">
        <input
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          placeholder="Untitled"
          className="w-full font-display text-3xl text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>

      {updateMutation.isError && (
        <p className="mb-4 font-mono text-sm text-alert">{(updateMutation.error as Error).message}</p>
      )}

      {Object.keys(note.frontmatter).length > 0 && (
        <dl className="mb-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border border-dust p-3 font-mono text-xs">
          {Object.entries(note.frontmatter).map(([key, value]) => (
            <div className="contents" key={key}>
              <dt className="text-dust uppercase">{key}</dt>
              <dd className="text-slate">{JSON.stringify(value)}</dd>
            </div>
          ))}
        </dl>
      )}

      <ExhibitLinksLayout
        exhibitId={`note-${noteId}`}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("notes", r, navigate, shellHosted)}
        editable
        onCreateReference={onCreateExhibit}
        actions={
          <ExhibitActionBar>
            <button
              onClick={() => pinMutation.mutate(!note.pinned)}
              className="tap-target text-accent hover:underline"
            >
              {note.pinned ? "Unpin" : "Pin"}
            </button>
            <button
              onClick={() => setConfirmingDelete(true)}
              className="tap-target text-alert hover:underline"
            >
              Delete
            </button>
          </ExhibitActionBar>
        }
      >
        <ExhibitFieldEditor
          value={draftContent}
          onChange={setDraftContent}
          minRows={3}
          placeholder="Start writing. Type @ to reference a note, event, or other Exhibit."
          className="w-full bg-parchment p-3 font-body text-base text-ink focus-within:outline-none"
          renderIcon={(chamber) => getChamberIcon(chamber)}
          onNavigate={(r) => navigateToExhibit("notes", r, navigate, shellHosted)}
          onCreate={onCreateExhibit}
        />
      </ExhibitLinksLayout>
      <ConfirmSheet
        open={confirmingDelete}
        title="Delete note"
        message={`Delete "${note.title}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => {
          setConfirmingDelete(false);
          deleteMutation.mutate();
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </article>
  );
}
