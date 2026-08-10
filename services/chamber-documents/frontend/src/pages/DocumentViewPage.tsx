import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useExhibitPicker,
  ExhibitPickerDropdown,
  ExhibitAnnotatedText,
  ExhibitSharingBadge,
  ExhibitLinksLayout,
  ShareControl,
  navigateToExhibit,
} from "@congress/exhibit-ui";
import { fetchDocument, updateDocument, deleteDocument, downloadUrl } from "@/lib/api";
import { getChamberIcon } from "@/components/ChamberIcon";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentViewPage() {
  const { id } = useParams<{ id: string }>();
  const documentId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");

  const documentQuery = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => fetchDocument(documentId),
    enabled: Number.isInteger(documentId),
  });

  const picker = useExhibitPicker({ value: draftDescription, onChange: setDraftDescription });

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
      navigate("/");
    },
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

  return (
    <article>
      <div className="mb-6 flex flex-col gap-3 border-b border-dust pb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        {editing ? (
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            className="min-w-0 flex-1 font-display text-3xl text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          />
        ) : (
          <h2 className="flex min-w-0 flex-1 items-center gap-3 font-display text-3xl text-ink">
            {doc.title}
            <ExhibitSharingBadge exhibitId={`document-${doc.id}`} className="exhibit-sharing-badge" />
          </h2>
        )}
        <div className="flex shrink-0 gap-5 font-mono text-xs uppercase tracking-wide">
          {editing ? (
            <>
              <button
                onClick={() => updateMutation.mutate({ title: draftTitle, description: draftDescription })}
                className="tap-target text-accent hover:underline"
              >
                Save
              </button>
              <button onClick={() => setEditing(false)} className="tap-target text-slate hover:underline">
                Cancel
              </button>
            </>
          ) : (
            <>
              <ShareControl chamber="documents" exhibitId={`document-${doc.id}`} exhibitName={doc.title} />
              <button onClick={() => setEditing(true)} className="tap-target text-accent hover:underline">
                Edit
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete "${doc.title}"? This cannot be undone.`)) {
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
        <div className="exhibit-field">
          <textarea
            {...picker.fieldProps}
            value={draftDescription}
            onChange={(e) => setDraftDescription(e.target.value)}
            rows={10}
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
          exhibitId={`document-${doc.id}`}
          emptyBacklinksLabel="Nothing references this document"
          emptyFrontlinksLabel="This document references nothing"
          renderIcon={(chamber) => getChamberIcon(chamber)}
          onNavigate={(r) => navigateToExhibit("documents", r, navigate)}
        >
          {doc.description ? (
            <ExhibitAnnotatedText
              text={doc.description}
              renderIcon={(chamber) => getChamberIcon(chamber)}
              onNavigate={(r) => navigateToExhibit("documents", r, navigate)}
              className="whitespace-pre-wrap font-mono text-sm text-ink"
            />
          ) : (
            <p className="font-mono text-sm text-dust">— No description —</p>
          )}
        </ExhibitLinksLayout>
      )}
    </article>
  );
}
