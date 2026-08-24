import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ExhibitTextarea,
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
import { createTask, quickCreateTaskExhibit } from "@/lib/api";

// Mirrors TaskViewPage's editing state exactly (name input, due date,
// ExhibitTextarea, ExhibitLinksLayout with a live Connections panel) rather
// than a plain form. Connections picked here are staged (ExhibitLinksLayout's
// `exhibitId={null}` mode) and only actually written once the create
// mutation below hands them a real id to attach to.
export function NewTaskPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [name, setName] = useState(searchParams.get("name") ?? "");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [draftConnections, setDraftConnections] = useState<CapitolExhibitSearchResult[]>([]);

  const mutation = useMutation({
    mutationFn: async () => {
      const created = await createTask({ name, description, dueDate: dueDate || null });
      await flushDraftConnections(`task-${created.id}`, draftConnections);
      return created;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      navigate(resolveChamberPath(`/t/${created.id}`, "tasks", shellHosted));
    },
  });

  async function onCreateExhibit(title: string) {
    const result = await quickCreateTaskExhibit(title);
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    return result;
  }

  return (
    <article>
      <div className="mb-6 border-b border-dust pb-4">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="w-full font-display text-3xl text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>

      {mutation.isError && <FormErrorMessage>{(mutation.error as Error).message}</FormErrorMessage>}

      <div className="mb-6">
        <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">Due date (optional)</label>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="border border-dust bg-parchment px-3 py-2 font-mono text-base text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>

      <ExhibitLinksLayout
        exhibitId={null}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("tasks", r, navigate, shellHosted)}
        editable
        onCreateReference={onCreateExhibit}
        draftConnections={draftConnections}
        onDraftConnectionsChange={setDraftConnections}
        actions={
          <ExhibitActionBar>
            <button
              onClick={() => name.trim() && mutation.mutate()}
              disabled={!name.trim() || mutation.isPending}
              className="tap-target text-accent hover:underline disabled:opacity-50"
            >
              {mutation.isPending ? "Creating —" : "Create"}
            </button>
            <button
              onClick={() => navigate(resolveChamberPath("/", "tasks", shellHosted))}
              className="tap-target text-slate hover:underline"
            >
              Cancel
            </button>
          </ExhibitActionBar>
        }
      >
        <ExhibitTextarea
          value={description}
          onChange={setDescription}
          rows={12}
          placeholder="Description (optional), [[ to reference an Exhibit"
          className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          renderIcon={(chamber) => getChamberIcon(chamber)}
          onCreate={onCreateExhibit}
        />
      </ExhibitLinksLayout>
    </article>
  );
}
