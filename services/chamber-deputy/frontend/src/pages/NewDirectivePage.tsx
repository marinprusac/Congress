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
import { createDirective } from "@/lib/api";

// Mirrors DirectiveViewPage's editing state exactly (title input,
// ExhibitTextarea, ExhibitLinksLayout with a live Connections panel) rather
// than a plain form. Connections picked here are staged (ExhibitLinksLayout's
// `exhibitId={null}` mode) and only actually written once the create
// mutation below hands them a real id to attach to.
export function NewDirectivePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(searchParams.get("name") ?? "");
  const [body, setBody] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState("");
  const [draftConnections, setDraftConnections] = useState<CapitolExhibitSearchResult[]>([]);

  const mutation = useMutation({
    mutationFn: async () => {
      const intervalMs = intervalMinutes.trim() ? Number(intervalMinutes) * 60_000 : null;
      const created = await createDirective({ title, body, enabled: true, intervalMs });
      await flushDraftConnections(`directive-${created.id}`, draftConnections);
      return created;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["directives"] });
      navigate(resolveChamberPath(`/d/${created.id}`, "deputy", shellHosted));
    },
  });

  const canSubmit = title.trim().length > 0;

  return (
    <article>
      <div className="mb-6 border-b border-dust pb-4">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Morning overdue-task check"
          className="w-full font-display text-3xl text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>

      {mutation.isError && <FormErrorMessage>{(mutation.error as Error).message}</FormErrorMessage>}

      <ExhibitLinksLayout
        exhibitId={null}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("deputy", r, navigate, shellHosted)}
        editable
        draftConnections={draftConnections}
        onDraftConnectionsChange={setDraftConnections}
        actions={
          <ExhibitActionBar>
            <button
              onClick={() => canSubmit && mutation.mutate()}
              disabled={!canSubmit || mutation.isPending}
              className="tap-target text-accent hover:underline disabled:opacity-50"
            >
              {mutation.isPending ? "Creating —" : "Create"}
            </button>
            <button
              onClick={() => navigate(resolveChamberPath("/", "deputy", shellHosted))}
              className="tap-target text-slate hover:underline"
            >
              Cancel
            </button>
          </ExhibitActionBar>
        }
      >
        <ExhibitTextarea
          value={body}
          onChange={setBody}
          rows={10}
          placeholder="Plain English - what should Deputy check or do, and when. Purely time-based ('every morning...') and event-reactive directives both go here."
          className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          renderIcon={(chamber) => getChamberIcon(chamber)}
        />
        <label className="mt-3 flex items-center gap-2 font-mono text-xs uppercase tracking-wide text-slate">
          Run automatically every
          <input
            type="number"
            min={1}
            value={intervalMinutes}
            onChange={(e) => setIntervalMinutes(e.target.value)}
            placeholder="manual only"
            className="w-24 border border-dust bg-parchment px-2 py-1 text-ink normal-case tracking-normal focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          />
          minutes (blank = play button only)
        </label>
      </ExhibitLinksLayout>
    </article>
  );
}
