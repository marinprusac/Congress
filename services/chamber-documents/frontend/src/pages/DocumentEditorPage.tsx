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
  flushDraftConnections,
  ConfirmSheet,
  showToast,
  useAutosave,
  useDraftCreate,
  resolveEditorIdentity,
  useSelfNavigateGuard,
  FormErrorMessage,
} from "@congress/congress-ui";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";
import { uploadDocument, fetchDocument, updateDocument, deleteDocument, downloadUrl } from "@/lib/api";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseDocumentId(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

// Handles both "create" (route `/new`, no `:id`) and "edit" (route `/d/:id`)
// as one mounted component - see chamber-notes' NoteEditorPage, which this
// mirrors, for the full reasoning behind merging the two. The file picker
// is the one field with no editing counterpart at all - a document's file
// can't be replaced after upload - so it only ever renders while still a
// draft, sitting above the rest like a fixed prerequisite exactly as it did
// on the old separate UploadDocumentPage.
export function DocumentEditorPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();

  const [documentId, setDocumentId] = useState<number | null>(() => parseDocumentId(idParam));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [draftConnections, setDraftConnections] = useState<CapitolExhibitSearchResult[]>([]);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const { markSelfNavigate, consumeSelfNavigate } = useSelfNavigateGuard();

  const documentQuery = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => fetchDocument(documentId as number),
    enabled: documentId !== null,
  });

  const createMutation = useMutation({
    // Reads `file` via closure rather than threading it through
    // useDraftCreate's `value` (a File isn't JSON-serializable, so it can't
    // be part of the debounce/content-key-tracked value) - safe because
    // `mutate()` invokes this synchronously off whatever render was current
    // when `attempt()` ran, strictly before the identity-reset effect's own
    // `setFile(null)` (the line right after its `attempt()` call) has had a
    // chance to commit.
    mutationFn: async (v: { title: string; description: string }) => {
      const created = await uploadDocument({ title: v.title, description: v.description, file: file! });
      await flushDraftConnections(`document-${created.id}`, draftConnections);
      return created;
    },
    onSuccess: (created, v) => {
      queryClient.setQueryData(["document", created.id], created);
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      if (documentId !== null) return;
      initializedDocumentIdRef.current = created.id;
      // Matches the update-mode autosave's own `value` shape below (no
      // `hasFile` - upload-only) so this doesn't immediately read as an
      // unsaved change and fire a redundant update right after creation.
      markSaved(v);
      setDocumentId(created.id);
      markSelfNavigate();
      navigate(resolveChamberPath(`/d/${created.id}`, "documents", shellHosted), { replace: true });
    },
    onError: () => {
      draftCreate.reset();
      showToast("Failed to upload document.", "error");
    },
  });

  // Fires on the title field's blur (see the input's onBlur below) and on
  // the file picker's own onChange (see the effect below) rather than a
  // content-change debounce - see useDraftCreate's own comment. Requires
  // both a title *and* a picked file, so whichever one is filled in last
  // (in either order) is what should fire it.
  const draftCreate = useDraftCreate({
    value: { title: draftTitle, description: draftDescription, hasFile: file !== null },
    canCreate: (v) => documentId === null && v.title.trim().length > 0 && v.hasFile,
    onCreate: (v) => createMutation.mutate({ title: v.title, description: v.description }),
  });

  // Picking a file is a discrete action, not continuous typing - this must
  // be an effect rather than calling `attempt()` inline from the file
  // input's `onChange`, since `attempt()` reads `hasFile` through a ref
  // that only catches up on the *next* render.
  useEffect(() => {
    draftCreate.attempt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // A navigation between two different documents, or back to the draft/
  // "new" route, reuses this same mounted component - see
  // resolveEditorIdentity's own comment. consumeSelfNavigate() must run
  // first - see useSelfNavigateGuard's own comment for the params-vs-state
  // race it closes (and the duplicate create/upload it caused before this
  // guard existed).
  useEffect(() => {
    if (consumeSelfNavigate()) return;
    const fromUrl = parseDocumentId(idParam);
    if (resolveEditorIdentity(fromUrl, documentId) === "keep") return;
    draftCreate.attempt();
    setDocumentId(fromUrl);
    setDraftTitle("");
    setDraftDescription("");
    setFile(null);
    setDraftConnections([]);
    initializedDocumentIdRef.current = null;
    draftCreate.reset();
    if (fromUrl === null) titleInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idParam, documentId]);

  const updateMutation = useMutation({
    mutationFn: (input: { title: string; description: string }) => updateDocument(documentId as number, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(["document", documentId], updated);
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteDocument(documentId as number),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      navigate(resolveChamberPath("/", "documents", shellHosted));
      showToast("Document deleted");
    },
    onError: () => showToast("Failed to delete document.", "error"),
  });

  // Loads drafts exactly once per document, not on every background
  // refetch - otherwise a resync would stomp in-progress edits. Also
  // covers the just-uploaded document: its query is pre-seeded via
  // setQueryData above, so this effect's `markSaved` runs immediately
  // without feeding a stale/empty server value back into the editor.
  const initializedDocumentIdRef = useRef<number | null>(null);
  const { markSaved } = useAutosave({
    value: { title: draftTitle, description: draftDescription },
    enabled: documentId !== null && initializedDocumentIdRef.current === documentId,
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

  const isDraft = documentId === null;
  if (!isDraft && documentQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (!isDraft && (documentQuery.isError || !documentQuery.data))
    return <p className="font-mono text-sm text-alert">Document not found.</p>;

  const doc = isDraft ? null : documentQuery.data ?? null;

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
        <FormErrorMessage>{(createMutation.error as Error).message}</FormErrorMessage>
      )}
      {updateMutation.isError && (
        <p className="mb-4 font-mono text-sm text-alert">{(updateMutation.error as Error).message}</p>
      )}

      {isDraft ? (
        <div className="mb-6">
          <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">File</label>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink file:mr-3 file:border-0 file:bg-ink/5 file:px-3 file:py-1.5 file:font-mono file:text-xs file:uppercase file:tracking-wide file:text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          />
        </div>
      ) : (
        doc && (
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
        )
      )}

      <ExhibitLinksLayout
        exhibitId={isDraft ? null : `document-${documentId}`}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("documents", r, navigate, shellHosted)}
        editable
        draftConnections={draftConnections}
        onDraftConnectionsChange={setDraftConnections}
        actions={
          <ExhibitActionBar>
            {isDraft ? (
              <button
                onClick={() => navigate(resolveChamberPath("/", "documents", shellHosted))}
                className="tap-target text-slate hover:underline"
              >
                Cancel
              </button>
            ) : (
              <button onClick={() => setConfirmingDelete(true)} className="tap-target text-alert hover:underline">
                Delete
              </button>
            )}
          </ExhibitActionBar>
        }
      >
        <ExhibitFieldEditor
          value={draftDescription}
          onChange={setDraftDescription}
          minRows={isDraft ? 8 : 3}
          placeholder={isDraft ? "Description (optional), @ to reference an Exhibit" : "— No description —"}
          className="w-full bg-parchment p-3 font-body text-base text-ink focus-within:outline-none"
          renderIcon={(chamber) => getChamberIcon(chamber)}
          onNavigate={(r) => navigateToExhibit("documents", r, navigate, shellHosted)}
        />
      </ExhibitLinksLayout>
      {!isDraft && (
        <ConfirmSheet
          open={confirmingDelete}
          title="Delete document"
          message={`Delete "${doc?.title}"? This cannot be undone.`}
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
