import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExhibitTextarea,
  ExhibitActionBar,
  ExhibitMarkdown,
  ExhibitLinksLayout,
  navigateToExhibit,
  getChamberIcon,
  stripFrontmatter,
  useShellHosted,
  resolveChamberPath,
  ConfirmSheet,
  showToast,
} from "@congress/congress-ui";
import { fetchNote, updateNote, deleteNote, setPinned, fetchSettings, quickCreateNoteExhibit } from "@/lib/api";
import type { NoteSummary } from "../../../src/types";

export function NoteViewPage() {
  const { id } = useParams<{ id: string }>();
  const noteId = Number(id);
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const articleRef = useRef<HTMLElement>(null);
  const contentFieldRef = useRef<HTMLTextAreaElement | null>(null);
  const titleFieldRef = useRef<HTMLInputElement | null>(null);
  // Mirror the latest draft/query state into refs so the click-outside and
  // ⌘S effects below can depend on `editing` alone instead of on
  // draftTitle/draftContent themselves - those two change on every
  // keystroke, and depending on them meant tearing down and re-adding both
  // document-level listeners once per character typed.
  const draftTitleRef = useRef(draftTitle);
  draftTitleRef.current = draftTitle;
  const draftContentRef = useRef(draftContent);
  draftContentRef.current = draftContent;

  const noteQuery = useQuery({
    queryKey: ["note", noteId],
    queryFn: () => fetchNote(noteId),
    enabled: Number.isInteger(noteId),
  });
  const noteDataRef = useRef(noteQuery.data);
  noteDataRef.current = noteQuery.data;

  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });

  const updateMutation = useMutation({
    mutationFn: (input: { title: string; content: string }) => updateNote(noteId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(["note", noteId], updated);
      // Keeps the home list's title/excerpt/pinned/updatedAt in sync live,
      // without the network round-trip a full invalidate would cost - an
      // autosave firing every 1.2s while typing used to invalidate ["notes"]
      // outright, refetching every note's body just to redraw one row's
      // excerpt. A real resync still happens on explicit save/unmount below.
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

  // Always reads the latest draft via refs (below) rather than closing over
  // `draftTitle`/`draftContent` state directly, so it stays correct even
  // when called from a stale closure captured by an effect that no longer
  // re-runs on every keystroke (see the outside-click/⌘S effects).
  function saveExplicit() {
    updateMutation.mutate(
      { title: draftTitleRef.current, content: draftContentRef.current },
      {
        onSuccess: () => {
          setEditing(false);
          queryClient.invalidateQueries({ queryKey: ["notes"] });
        },
      }
    );
  }

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

  useEffect(() => {
    if (noteQuery.data && !editing) {
      setDraftTitle(noteQuery.data.title);
      setDraftContent(noteQuery.data.content);
    }
  }, [noteQuery.data, editing]);

  useEffect(() => {
    if (!editing || !settingsQuery.data?.autoSave || !noteQuery.data) return;
    if (draftTitle === noteQuery.data.title && draftContent === noteQuery.data.content) return;
    const timer = setTimeout(() => {
      updateMutation.mutate({ title: draftTitle, content: draftContent });
    }, 1200);
    return () => clearTimeout(timer);
  }, [editing, settingsQuery.data?.autoSave, draftTitle, draftContent, noteQuery.data]);

  useEffect(() => {
    if (!editing) return;
    function onOutsideDown(e: MouseEvent) {
      if (!(e.target instanceof Node) || articleRef.current?.contains(e.target)) return;
      const data = noteDataRef.current;
      if (!data) return;
      if (draftTitleRef.current === data.title && draftContentRef.current === data.content) {
        setEditing(false);
      } else {
        saveExplicit();
      }
    }
    document.addEventListener("mousedown", onOutsideDown);
    return () => document.removeEventListener("mousedown", onOutsideDown);
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveExplicit();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editing]);

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
  const body = stripFrontmatter(note.content);

  function editTitle() {
    setEditing(true);
    requestAnimationFrame(() => {
      titleFieldRef.current?.focus();
      titleFieldRef.current?.select();
    });
  }

  function editAtFraction(fraction: number) {
    const prefixLength = note.content.length - body.length;
    const offset = Math.round(prefixLength + fraction * body.length);
    setEditing(true);
    requestAnimationFrame(() => {
      const el = contentFieldRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(offset, offset);
      }
    });
  }

  return (
    <article ref={articleRef}>
      <div className="mb-6 border-b border-dust pb-4">
        {editing ? (
          <input
            ref={titleFieldRef}
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            className="w-full font-display text-3xl text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          />
        ) : (
          <h2
            className="flex min-w-0 items-center gap-3 font-display text-3xl text-ink"
            onDoubleClick={editTitle}
            title="Double-click to edit"
          >
            {note.title}
          </h2>
        )}
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
            {editing ? (
              <>
                {!settingsQuery.data?.autoSave && (
                  <button onClick={saveExplicit} className="tap-target text-accent hover:underline">
                    Save
                  </button>
                )}
                <button onClick={() => setEditing(false)} className="tap-target text-slate hover:underline">
                  {settingsQuery.data?.autoSave ? "Close" : "Cancel"}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => pinMutation.mutate(!note.pinned)}
                  className="tap-target text-accent hover:underline"
                >
                  {note.pinned ? "Unpin" : "Pin"}
                </button>
                <button onClick={() => setEditing(true)} className="tap-target text-accent hover:underline">
                  Edit
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
        {editing ? (
          <ExhibitTextarea
            ref={contentFieldRef}
            value={draftContent}
            onChange={setDraftContent}
            rows={20}
            className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
            renderIcon={(chamber) => getChamberIcon(chamber)}
            onCreate={onCreateExhibit}
          />
        ) : (
          <ExhibitMarkdown
            body={body}
            onDoubleClick={editAtFraction}
            onNavigate={(r) => navigateToExhibit("notes", r, navigate, shellHosted)}
          />
        )}
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
