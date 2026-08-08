import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchNote, fetchNotes, updateNote, deleteNote, setPinned } from "@/lib/api";
import { NoteMarkdown } from "@/components/NoteMarkdown";
import { stripFrontmatter } from "@/lib/frontmatter";

export function NoteViewPage() {
  const { id } = useParams<{ id: string }>();
  const noteId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");

  const noteQuery = useQuery({
    queryKey: ["note", noteId],
    queryFn: () => fetchNote(noteId),
    enabled: Number.isInteger(noteId),
  });

  const notesIndexQuery = useQuery({ queryKey: ["notes"], queryFn: fetchNotes });

  const titleToId = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notesIndexQuery.data ?? []) map.set(n.title.toLowerCase(), n.id);
    return map;
  }, [notesIndexQuery.data]);

  const updateMutation = useMutation({
    mutationFn: (input: { title: string; content: string }) => updateNote(noteId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(["note", noteId], updated);
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      setEditing(false);
    },
  });

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

  if (!Number.isInteger(noteId)) return <p className="font-mono text-sm text-alert">Invalid note id.</p>;
  if (noteQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (noteQuery.isError || !noteQuery.data)
    return <p className="font-mono text-sm text-alert">Note not found.</p>;

  const note = noteQuery.data;
  const body = stripFrontmatter(note.content);

  return (
    <article>
      <div className="mb-6 flex items-start justify-between gap-4 border-b border-dust pb-4">
        {editing ? (
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            className="font-display text-3xl text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          />
        ) : (
          <h2 className="font-display text-3xl text-ink">{note.title}</h2>
        )}
        <div className="flex shrink-0 gap-3 font-mono text-xs uppercase tracking-wide">
          {editing ? (
            <>
              <button
                onClick={() => updateMutation.mutate({ title: draftTitle, content: draftContent })}
                className="text-accent hover:underline"
              >
                Save
              </button>
              <button onClick={() => setEditing(false)} className="text-slate hover:underline">
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => pinMutation.mutate(!note.pinned)}
                className="text-accent hover:underline"
              >
                {note.pinned ? "Unpin" : "Pin"}
              </button>
              <button onClick={() => setEditing(true)} className="text-accent hover:underline">
                Edit
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete "${note.title}"? This cannot be undone.`)) {
                    deleteMutation.mutate();
                  }
                }}
                className="text-alert hover:underline"
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
        <textarea
          value={draftContent}
          onChange={(e) => setDraftContent(e.target.value)}
          rows={20}
          className="w-full border border-dust bg-parchment p-3 font-mono text-sm text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
      ) : (
        <NoteMarkdown body={body} resolveTitle={(t) => titleToId.get(t.toLowerCase())} />
      )}

      {!editing && (
        <section className="mt-10 border-t border-dust pt-4">
          <h3 className="mb-2 font-mono text-xs uppercase tracking-wide text-dust">
            Backlinks ({note.backlinks.length})
          </h3>
          {note.backlinks.length === 0 ? (
            <p className="font-mono text-sm text-dust">— No notes link here —</p>
          ) : (
            <ul>
              {note.backlinks.map((b) => (
                <li key={b.id} className="border-b border-dust py-2">
                  <Link to={`/n/${b.id}`} className="font-mono text-sm wikilink-resolved">
                    {b.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </article>
  );
}
