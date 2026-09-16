import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExhibitFieldEditor,
  ExhibitActionBar,
  ExhibitLinksLayout,
  navigateToExhibit,
  getChamberIcon,
  useShellHosted,
  resolveChamberPath,
  flushDraftConnections,
  ConfirmSheet,
  showToast,
  useAutosave,
  useDraftCreate,
  resolveEditorIdentity,
} from "@congress/congress-ui";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";
import { createNote, fetchNote, updateNote, deleteNote, setPinned, quickCreateNoteExhibit } from "@/lib/api";
import type { NoteSummary } from "../../../src/types";

function parseNoteId(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

// Handles both "create" (route `/new`, no `:id`) and "edit" (route
// `/n/:id`) as one mounted component rather than two - a new note is just
// an existing note whose id doesn't exist yet, and the two used to be
// separate pages/components that mirrored each other's field layout by
// hand. Splitting them meant the first autosave (the create) navigated from
// one to the other, unmounting the live editor and stealing focus mid-typing
// - see useDraftCreate's own comment for why creation is now triggered by
// the title field's blur instead of a content debounce, and why the
// post-create `navigate` below is a `replace` from within this same
// component instance rather than a route change to a different one.
export function NoteEditorPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();

  // Seeded from the URL param once, then never re-read from it - so the
  // `navigate(..., { replace: true })` after a create doesn't loop back
  // through this initializer and reset state.
  const [noteId, setNoteId] = useState<number | null>(() => parseNoteId(idParam));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draftTitle, setDraftTitle] = useState(searchParams.get("title") ?? "");
  const [draftContent, setDraftContent] = useState("");
  const [draftConnections, setDraftConnections] = useState<CapitolExhibitSearchResult[]>([]);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  const noteQuery = useQuery({
    queryKey: ["note", noteId],
    queryFn: () => fetchNote(noteId as number),
    enabled: noteId !== null,
  });

  const createMutation = useMutation({
    mutationFn: async (draft: { title: string; content: string }) => {
      const created = await createNote(draft);
      await flushDraftConnections(`note-${created.id}`, draftConnections);
      return created;
    },
    onSuccess: (created, draft) => {
      queryClient.setQueryData(["note", created.id], created);
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      // `noteId` may have already moved on to a different note by the time
      // this resolves - the identity-reset effect below flushes an
      // abandoned draft's create (so it isn't silently discarded) without
      // waiting for it to finish, so the user can already be looking at
      // something else. In that case just let this one persist quietly
      // rather than hijacking their current view.
      if (noteId !== null) return;
      // Already reflects the just-created draft, so the server round-trip
      // above isn't read back into the editor as an incoming change, and
      // the edit-mode autosave below doesn't immediately re-fire a
      // redundant update for content it just persisted.
      initializedNoteIdRef.current = created.id;
      markSaved(draft);
      setNoteId(created.id);
      navigate(resolveChamberPath(`/n/${created.id}`, "notes", shellHosted), { replace: true });
    },
    onError: () => {
      draftCreate.reset();
      showToast("Failed to create note.", "error");
    },
  });

  // Fires the create on the title field's blur (see the input's onBlur
  // below) rather than on a content-change debounce, so it can't land
  // mid-keystroke - and at most once, guarded against a stray double-blur
  // or the unmount flush both firing for the same draft.
  const draftCreate = useDraftCreate({
    value: { title: draftTitle, content: draftContent },
    canCreate: (v) => noteId === null && v.title.trim().length > 0,
    onCreate: (draft) => createMutation.mutate(draft),
  });

  // A navigation straight from one persisted note to another (an Exhibit
  // chip pointing at a sibling note) or back to the draft `/new` route
  // reuses this same mounted component - see the module comment - so
  // `noteId` doesn't just track `idParam` the way a fresh mount's
  // initializer would. This is what makes that transition behave like
  // opening a different note instead of silently continuing to show the
  // previous one. resolveEditorIdentity tells it apart from the
  // identical-looking case of the URL catching up with this page's own
  // create `navigate(..., { replace: true })`, which must NOT reset.
  useEffect(() => {
    const fromUrl = parseNoteId(idParam);
    if (resolveEditorIdentity(fromUrl, noteId) === "keep") return;
    // Flushes a half-typed, never-blurred draft before abandoning it (e.g.
    // navigating away via a chip already sitting in the body) so it can't
    // be silently discarded - a no-op if there's no title yet or the
    // create already fired. Must run before the state below is cleared,
    // since it reads the about-to-be-abandoned draftTitle/draftContent;
    // createMutation's own onSuccess checks `noteId` again once it resolves
    // so it doesn't hijack whatever the user has already navigated to.
    draftCreate.attempt();
    setNoteId(fromUrl);
    setDraftTitle("");
    setDraftContent("");
    setDraftConnections([]);
    initializedNoteIdRef.current = null;
    draftCreate.reset();
    if (fromUrl === null) titleInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idParam, noteId]);

  const updateMutation = useMutation({
    mutationFn: (input: { title: string; content: string }) => updateNote(noteId as number, input),
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
      if (noteId !== null) queryClient.invalidateQueries({ queryKey: ["notes"] });
    };
  }, [queryClient, noteId]);

  const deleteMutation = useMutation({
    mutationFn: () => deleteNote(noteId as number),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      navigate(resolveChamberPath("/", "notes", shellHosted));
      showToast("Note deleted");
    },
    onError: () => showToast("Failed to delete note.", "error"),
  });

  const pinMutation = useMutation({
    mutationFn: (pinned: boolean) => setPinned(noteId as number, pinned),
    onSuccess: (updated) => {
      queryClient.setQueryData(["note", noteId], updated);
      queryClient.invalidateQueries({ queryKey: ["notes"] });
    },
  });

  // Loads drafts from the server exactly once per note - a background
  // refetch of the same note (e.g. after a pin toggle) must never stomp
  // in-progress local edits, but navigating to a *different* note (a new
  // `noteId`, hence a fresh id on the fetched data) must reset them. Also
  // covers the just-created note: its query is pre-seeded via setQueryData
  // above, so this effect's `markSaved` runs immediately without ever
  // feeding a stale/empty server value back into the editor.
  const initializedNoteIdRef = useRef<number | null>(null);
  const { markSaved } = useAutosave({
    value: { title: draftTitle, content: draftContent },
    enabled: noteId !== null && initializedNoteIdRef.current === noteId,
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

  const isDraft = noteId === null;
  if (!isDraft && noteQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (!isDraft && (noteQuery.isError || !noteQuery.data))
    return <p className="font-mono text-sm text-alert">Note not found.</p>;

  const note = isDraft ? null : noteQuery.data ?? null;
  const frontmatter = note?.frontmatter ?? {};

  return (
    <article>
      <div className="mb-6 border-b border-dust pb-4">
        <input
          ref={titleInputRef}
          autoFocus={isDraft}
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onBlur={() => draftCreate.attempt()}
          placeholder={isDraft ? "Title" : "Untitled"}
          className="w-full font-display text-3xl text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>

      {createMutation.isError && (
        <p className="mb-4 font-mono text-sm text-alert">{(createMutation.error as Error).message}</p>
      )}
      {updateMutation.isError && (
        <p className="mb-4 font-mono text-sm text-alert">{(updateMutation.error as Error).message}</p>
      )}

      {Object.keys(frontmatter).length > 0 && (
        <dl className="mb-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border border-dust p-3 font-mono text-xs">
          {Object.entries(frontmatter).map(([key, value]) => (
            <div className="contents" key={key}>
              <dt className="text-dust uppercase">{key}</dt>
              <dd className="text-slate">{JSON.stringify(value)}</dd>
            </div>
          ))}
        </dl>
      )}

      <ExhibitLinksLayout
        exhibitId={isDraft ? null : `note-${noteId}`}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("notes", r, navigate, shellHosted)}
        editable
        onCreateReference={onCreateExhibit}
        draftConnections={draftConnections}
        onDraftConnectionsChange={setDraftConnections}
        actions={
          <ExhibitActionBar>
            {isDraft ? (
              <button
                onClick={() => navigate(resolveChamberPath("/", "notes", shellHosted))}
                className="tap-target text-slate hover:underline"
              >
                Cancel
              </button>
            ) : (
              <>
                <button
                  onClick={() => pinMutation.mutate(!note?.pinned)}
                  className="tap-target text-accent hover:underline"
                >
                  {note?.pinned ? "Unpin" : "Pin"}
                </button>
                <button
                  onClick={() => setConfirmingDelete(true)}
                  className="tap-target text-alert hover:underline"
                >
                  Delete
                </button>
              </>
            )}
          </ExhibitActionBar>
        }
      >
        <ExhibitFieldEditor
          value={draftContent}
          onChange={setDraftContent}
          minRows={3}
          placeholder={
            isDraft
              ? "---\ntags: []\n---\nStart writing. Type @ to reference a note, event, or other Exhibit."
              : "Start writing. Type @ to reference a note, event, or other Exhibit."
          }
          className="w-full bg-parchment p-3 font-body text-base text-ink focus-within:outline-none"
          renderIcon={(chamber) => getChamberIcon(chamber)}
          onNavigate={(r) => navigateToExhibit("notes", r, navigate, shellHosted)}
          onCreate={onCreateExhibit}
        />
      </ExhibitLinksLayout>
      {!isDraft && (
        <ConfirmSheet
          open={confirmingDelete}
          title="Delete note"
          message={`Delete "${note?.title}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => {
            setConfirmingDelete(false);
            deleteMutation.mutate();
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </article>
  );
}
