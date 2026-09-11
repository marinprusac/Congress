import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
  FormErrorMessage,
  fetchEventCatalog,
  useAutosave,
} from "@congress/congress-ui";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";
import { createDirective } from "@/lib/api";
import { ScheduleEditor, EMPTY_SCHEDULE, type ScheduleDraft } from "@/components/ScheduleEditor";

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
  const [schedule, setSchedule] = useState<ScheduleDraft>(EMPTY_SCHEDULE);
  const [draftConnections, setDraftConnections] = useState<CapitolExhibitSearchResult[]>([]);

  const catalogQuery = useQuery({ queryKey: ["event-catalog"], queryFn: fetchEventCatalog });

  const mutation = useMutation({
    mutationFn: async () => {
      const created = await createDirective({ title, body, enabled: true, ...schedule });
      await flushDraftConnections(`directive-${created.id}`, draftConnections);
      return created;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["directives"] });
      navigate(resolveChamberPath(`/d/${created.id}`, "deputy", shellHosted));
    },
  });

  // No explicit Create action - like editing an existing directive, a filled
  // title is sufficient to persist. `enabled` drops as soon as the create
  // mutation starts so a debounced re-fire can't create a second directive.
  useAutosave({
    value: { title, body, schedule },
    enabled: title.trim().length > 0 && !mutation.isPending && !mutation.isSuccess,
    onSave: () => mutation.mutate(),
  });

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
              onClick={() => navigate(resolveChamberPath("/", "deputy", shellHosted))}
              className="tap-target text-slate hover:underline"
            >
              Cancel
            </button>
          </ExhibitActionBar>
        }
      >
        <ExhibitFieldEditor
          value={body}
          onChange={setBody}
          minRows={10}
          placeholder="Plain English - what should Deputy check or do, and when. Purely time-based ('every morning...') and event-reactive directives both go here."
          className="w-full bg-parchment p-3 font-body text-base text-ink focus-within:outline-none"
          renderIcon={(chamber) => getChamberIcon(chamber)}
        />
        <ScheduleEditor value={schedule} onChange={setSchedule} eventCatalog={catalogQuery.data ?? []} eventCatalogLoading={catalogQuery.isLoading} />
      </ExhibitLinksLayout>
    </article>
  );
}
