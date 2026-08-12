import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useExhibitPicker,
  ExhibitPickerDropdown,
  ExhibitSharingBadge,
  ExhibitLinksLayout,
  ShareControl,
  navigateToExhibit,
} from "@congress/exhibit-ui";
import { fetchNote, updateNote, deleteNote, setPinned, fetchSettings } from "@/lib/api";
import { NoteMarkdown } from "@/components/NoteMarkdown";
import { getChamberIcon } from "@/components/ChamberIcon";
import { stripFrontmatter } from "@/lib/frontmatter";

export function NoteViewPage() {
  const { id } = useParams<{ id: string }>();
  const noteId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const articleRef = useRef<HTMLElement>(null);
  const contentFieldRef = useRef<HTMLTextAreaElement | null>(null);

  const noteQuery = useQuery({
    queryKey: ["note", noteId],
    queryFn: () => fetchNote(noteId),
    enabled: Number.isInteger(noteId),
  });

  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });

  const picker = useExhibitPicker({
    value: draftContent,
    onChange: (newValue) => setDraftContent(newValue),
  });

  const updateMutation = useMutation({
    mutationFn: (input: { title: string; content: string }) => updateNote(noteId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(["note", noteId], updated);
      queryClient.invalidateQueries({ queryKey: ["notes"] });
    },
  });

  function saveExplicit() {
    updateMutation.mutate({ title: draftTitle, content: draftContent }, { onSuccess: () => setEditing(false) });
  }

  const deleteMutation = useMutation({
    mutationFn: () => deleteNote(noteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      navigate("/");
    },
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
    if (!editing || !noteQuery.data) return;
    function onOutsideDown(e: MouseEvent) {
      if (!(e.target instanceof Node) || articleRef.current?.contains(e.target)) return;
      if (draftTitle === noteQuery.data!.title && draftContent === noteQuery.data!.content) {
        setEditing(false);
      } else {
        saveExplicit();
      }
    }
    document.addEventListener("mousedown", onOutsideDown);
    return () => document.removeEventListener("mousedown", onOutsideDown);
  }, [editing, draftTitle, draftContent, noteQuery.data]);

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
  }, [editing, draftTitle, draftContent]);

  if (!Number.isInteger(noteId)) return <p className="font-mono text-sm text-alert">Invalid note id.</p>;
  if (noteQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (noteQuery.isError || !noteQuery.data)
    return <p className="font-mono text-sm text-alert">Note not found.</p>;

  const note = noteQuery.data;
  const body = stripFrontmatter(note.content);

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
      <div className="mb-6 flex flex-col gap-3 border-b border-dust pb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        {editing ? (
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            className="min-w-0 flex-1 font-display text-3xl text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          />
        ) : (
          <h2 className="flex min-w-0 flex-1 items-center gap-3 font-display text-3xl text-ink">
            {note.title}
            <ExhibitSharingBadge exhibitId={`note-${noteId}`} className="exhibit-sharing-badge" />
          </h2>
        )}
        <div className="flex shrink-0 items-center gap-5 font-mono text-xs uppercase tracking-wide">
          {editing ? (
            <>
              {settingsQuery.data?.autoSave ? (
                <span className="normal-case tracking-normal text-dust">
                  {updateMutation.isPending
                    ? "Saving —"
                    : draftTitle === note.title && draftContent === note.content
                      ? "Saved"
                      : ""}
                </span>
              ) : (
                <button onClick={saveExplicit} className="tap-target text-accent hover:underline">
                  Save
                </button>
              )}
              <button onClick={() => setEditing(false)} className="tap-target text-slate hover:underline">
                Cancel
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
              <ShareControl chamber="notes" exhibitId={`note-${noteId}`} exhibitName={note.title} />
              <button onClick={() => setEditing(true)} className="tap-target text-accent hover:underline">
                Edit
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete "${note.title}"? This cannot be undone.`)) {
                    deleteMutation.mutate();
                  }
                }}
                className="tap-target text-alert hover:underline"
              >
                Delete
              </button>
            </>
          )}
        </div>
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

      {editing ? (
        <div className="exhibit-field">
          <textarea
            {...picker.fieldProps}
            ref={(el) => {
              picker.fieldProps.ref(el);
              contentFieldRef.current = el;
            }}
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            rows={20}
            className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          />
          <ExhibitPickerDropdown
            picker={picker}
            renderIcon={(chamber) => getChamberIcon(chamber)}
            className="exhibit-picker-dropdown"
          />
        </div>
      ) : (
        <ExhibitLinksLayout
          exhibitId={`note-${noteId}`}
          emptyBacklinksLabel="Nothing references this note"
          emptyFrontlinksLabel="This note references nothing"
          renderIcon={(chamber) => getChamberIcon(chamber)}
          onNavigate={(r) => navigateToExhibit("notes", r, navigate)}
        >
          <NoteMarkdown body={body} onDoubleClick={editAtFraction} />
        </ExhibitLinksLayout>
      )}
    </article>
  );
}
