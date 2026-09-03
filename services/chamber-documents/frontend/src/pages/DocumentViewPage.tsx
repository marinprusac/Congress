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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");

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
  // - otherwise a resync would stomp in-progress edits.
  const initializedDocumentIdRef = useRef<number | null>(null);
  const { markSaved } = useAutosave({
    value: { title: draftTitle, description: draftDescription },
    enabled: initializedDocumentIdRef.current !== null,
    onSave: (draft) => updateMutation.mutate(draft),
  });
  useEffect(() => {
    if (documentQuery.data && initializedDocumentIdRef.current !== documentQuery.data.id) {
      const draft = { title: documentQuery.data.title, description: documentQuery.data.description };
      setDraftTitle(draft.title);
      setDraftDescription(draft.description);
      markSaved(draft);
      initializedDocumentIdRef.current = documentQuery.data.id;
    }
  }, [documentQuery.data, markSaved]);

  if (!Number.isInteger(documentId)) return <p className="font-mono text-sm text-alert">Invalid document id.</p>;
  if (documentQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (documentQuery.isError || !documentQuery.data)
    return <p className="font-mono text-sm text-alert">Document not found.</p>;

  const doc = documentQuery.data;

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
            <button onClick={() => setConfirmingDelete(true)} className="tap-target text-alert hover:underline">
              Delete
            </button>
          </ExhibitActionBar>
        }
      >
        <ExhibitFieldEditor
          value={draftDescription}
          onChange={setDraftDescription}
          minRows={3}
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
