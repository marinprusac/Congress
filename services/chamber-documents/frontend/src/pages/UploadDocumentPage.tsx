import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ExhibitFieldEditor,
  ExhibitActionBar,
  ExhibitLinksLayout,
  navigateToExhibit,
  getChamberIcon,
  useShellHosted,
  resolveChamberPath,
  flushDraftConnections,
  FormErrorMessage,
} from "@congress/congress-ui";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";
import { uploadDocument } from "@/lib/api";

// Mirrors DocumentViewPage's editing state (title input, ExhibitTextarea,
// ExhibitLinksLayout with a live Connections panel) rather than a plain
// form - the file picker is the one field that has no "editing" counterpart
// (a document's file can't be replaced after upload), so it sits above the
// rest like a fixed prerequisite. Connections picked here are staged
// (ExhibitLinksLayout's `exhibitId={null}` mode) and only actually written
// once the upload mutation below hands them a real id to attach to.
export function UploadDocumentPage() {
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [draftConnections, setDraftConnections] = useState<CapitolExhibitSearchResult[]>([]);

  const mutation = useMutation({
    mutationFn: async () => {
      const created = await uploadDocument({ title, description, file: file! });
      await flushDraftConnections(`document-${created.id}`, draftConnections);
      return created;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      navigate(resolveChamberPath(`/d/${created.id}`, "documents", shellHosted));
    },
  });

  return (
    <article>
      <div className="mb-6 border-b border-dust pb-4">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="w-full font-display text-3xl text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>

      {mutation.isError && <FormErrorMessage>{(mutation.error as Error).message}</FormErrorMessage>}

      <div className="mb-6">
        <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">File</label>
        <input
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="w-full border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink file:mr-3 file:border-0 file:bg-ink/5 file:px-3 file:py-1.5 file:font-mono file:text-xs file:uppercase file:tracking-wide file:text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>

      <ExhibitLinksLayout
        exhibitId={null}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("documents", r, navigate, shellHosted)}
        editable
        draftConnections={draftConnections}
        onDraftConnectionsChange={setDraftConnections}
        actions={
          <ExhibitActionBar>
            <button
              onClick={() => title.trim() && file && mutation.mutate()}
              disabled={!title.trim() || !file || mutation.isPending}
              className="tap-target text-accent hover:underline disabled:opacity-50"
            >
              {mutation.isPending ? "Uploading —" : "Upload"}
            </button>
            <button
              onClick={() => navigate(resolveChamberPath("/", "documents", shellHosted))}
              className="tap-target text-slate hover:underline"
            >
              Cancel
            </button>
          </ExhibitActionBar>
        }
      >
        <ExhibitFieldEditor
          value={description}
          onChange={setDescription}
          minRows={8}
          placeholder="Description (optional), @ to reference an Exhibit"
          className="w-full bg-parchment p-3 font-body text-base text-ink focus-within:outline-none"
          renderIcon={(chamber) => getChamberIcon(chamber)}
        />
      </ExhibitLinksLayout>
    </article>
  );
}
