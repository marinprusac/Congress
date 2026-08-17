import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExhibitTextarea,
  ExhibitActionBar,
  ExhibitAnnotatedText,
  ExhibitSharingBadge,
  ExhibitLinksLayout,
  ShareControl,
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

  useEffect(() => {
    if (documentQuery.data && !editing) {
      setDraftTitle(documentQuery.data.title);
      setDraftDescription(documentQuery.data.description);
    }
  }, [documentQuery.data, editing]);

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

  return (
    <article>
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
            {doc.title}
            <ExhibitSharingBadge exhibitId={`document-${doc.id}`} className="exhibit-sharing-badge" />
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

      {editing ? (
        <>
          <ExhibitTextarea
            value={draftDescription}
            onChange={setDraftDescription}
            rows={10}
            className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
            renderIcon={(chamber) => getChamberIcon(chamber)}
          />
          <ExhibitActionBar>
            <button
              onClick={() => updateMutation.mutate({ title: draftTitle, description: draftDescription })}
              className="tap-target text-accent hover:underline"
            >
              Save
            </button>
            <button onClick={() => setEditing(false)} className="tap-target text-slate hover:underline">
              Cancel
            </button>
          </ExhibitActionBar>
        </>
      ) : (
        <ExhibitLinksLayout
          exhibitId={`document-${doc.id}`}
          emptyBacklinksLabel="Nothing references this document"
          emptyFrontlinksLabel="This document references nothing"
          renderIcon={(chamber) => getChamberIcon(chamber)}
          onNavigate={(r) => navigateToExhibit("documents", r, navigate, shellHosted)}
          editable
        >
          {doc.description ? (
            <ExhibitAnnotatedText
              text={doc.description}
              renderIcon={(chamber) => getChamberIcon(chamber)}
              onNavigate={(r) => navigateToExhibit("documents", r, navigate, shellHosted)}
              className="whitespace-pre-wrap font-mono text-sm text-ink"
            />
          ) : (
            <p className="font-mono text-sm text-dust">— No description —</p>
          )}
          <ExhibitActionBar>
            <ShareControl chamber="documents" exhibitId={`document-${doc.id}`} exhibitName={doc.title} />
            <button onClick={() => setEditing(true)} className="tap-target text-accent hover:underline">
              Edit
            </button>
            <button
              onClick={() => setConfirmingDelete(true)}
              className="tap-target text-alert hover:underline"
            >
              Delete
            </button>
          </ExhibitActionBar>
        </ExhibitLinksLayout>
      )}
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
