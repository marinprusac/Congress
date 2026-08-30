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
} from "@congress/congress-ui";
import { fetchDocument, updateDocument, deleteDocument, downloadUrl } from "@/lib/api";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentViewPage() {
  const { id } = useParams<{ id: string }>();
  const documentId = Number(id);
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const titleFieldRef = useRef<HTMLInputElement | null>(null);

  const documentQuery = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => fetchDocument(documentId),
    enabled: Number.isInteger(documentId),
  });

  const updateMutation = useMutation({
    mutationFn: (input: { title: string; description: string }) => updateDocument(documentId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(["document", documentId], updated);
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      setEditing(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteDocument(documentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      navigate(resolveChamberPath("/", "documents", shellHosted));
      showToast("Document deleted");
    },
    onError: () => showToast("Failed to delete document.", "error"),
  });

  // Loads drafts exactly once per document, not on every background refetch
  // - the description is now always live (see below), so a resync gated on
  // `!editing` (editing only ever toggles the title) would stomp
  // in-progress description edits made while `editing` is false.
  const initializedDocumentIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (documentQuery.data && initializedDocumentIdRef.current !== documentQuery.data.id) {
      setDraftTitle(documentQuery.data.title);
      setDraftDescription(documentQuery.data.description);
      initializedDocumentIdRef.current = documentQuery.data.id;
    }
  }, [documentQuery.data]);

  if (!Number.isInteger(documentId)) return <p className="font-mono text-sm text-alert">Invalid document id.</p>;
  if (documentQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (documentQuery.isError || !documentQuery.data)
    return <p className="font-mono text-sm text-alert">Document not found.</p>;

  const doc = documentQuery.data;

  function editTitle() {
    setEditing(true);
    requestAnimationFrame(() => {
      titleFieldRef.current?.focus();
      titleFieldRef.current?.select();
    });
  }

  function save() {
    updateMutation.mutate({ title: draftTitle, description: draftDescription });
  }

  function cancel() {
    setEditing(false);
    setDraftTitle(doc.title);
    setDraftDescription(doc.description);
  }

  const descriptionDirty = draftDescription !== doc.description;
  const showSaveControls = editing || descriptionDirty;

  return (
    <article>
      <div className="mb-6 border-b border-dust pb-4">
        {editing ? (
          <input
            ref={titleFieldRef}
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="Untitled"
            className="w-full font-display text-3xl text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          />
        ) : (
          <h2
            className="flex min-w-0 cursor-text items-center gap-3 font-display text-3xl text-ink"
            onClick={editTitle}
            title="Click to edit"
          >
            {doc.title}
          </h2>
        )}
      </div>

      {updateMutation.isError && (
        <p className="mb-4 font-mono text-sm text-alert">{(updateMutation.error as Error).message}</p>
      )}

      <dl className="mb-6 space-y-3 font-mono text-sm">
        <div>
          <dt className="mb-1 text-xs uppercase tracking-wide text-dust">File</dt>
          <dd className="text-ink">
            <a href={downloadUrl(doc.id)} download className="text-accent hover:underline">
              {doc.filename}
            </a>
            <span className="ml-2 text-dust">
              ({doc.mimeType}, {formatBytes(doc.sizeBytes)})
            </span>
          </dd>
        </div>
      </dl>

      <ExhibitLinksLayout
        exhibitId={`document-${doc.id}`}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("documents", r, navigate, shellHosted)}
        editable
        actions={
          <ExhibitActionBar>
            {showSaveControls ? (
              <>
                <button onClick={save} className="tap-target text-accent hover:underline">
                  Save
                </button>
                <button onClick={cancel} className="tap-target text-slate hover:underline">
                  Cancel
                </button>
              </>
            ) : (
              <>
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
        <ExhibitFieldEditor
          value={draftDescription}
          onChange={setDraftDescription}
          minRows={10}
          placeholder="— No description —"
          className="w-full bg-parchment p-3 font-body text-base text-ink focus-within:outline-none"
          renderIcon={(chamber) => getChamberIcon(chamber)}
          onNavigate={(r) => navigateToExhibit("documents", r, navigate, shellHosted)}
        />
      </ExhibitLinksLayout>
      <ConfirmSheet
        open={confirmingDelete}
        title="Delete document"
        message={`Delete "${doc.title}"? This cannot be undone.`}
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
