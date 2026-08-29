import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  fetchEventCatalog,
  TriggerEventPicker,
} from "@congress/congress-ui";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";
import { createAutomation, fetchChamberTools } from "@/lib/api";
import { ChamberToolPicker } from "@/components/ChamberToolPicker";
import { ArgsEditor } from "@/components/ArgsEditor";

const inputClass =
  "w-full border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent";

function fieldLabel(children: React.ReactNode) {
  return <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">{children}</label>;
}

// Mirrors AutomationViewPage's editing state exactly (title input, trigger/
// action fields, ExhibitTextarea, ExhibitLinksLayout with a live Connections
// panel) rather than a plain form. Connections picked here are staged
// (ExhibitLinksLayout's `exhibitId={null}` mode) and only actually written
// once the create mutation below hands them a real id to attach to.
export function NewAutomationPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(searchParams.get("name") ?? "");
  const [body, setBody] = useState("");
  const [triggerEventType, setTriggerEventType] = useState("");
  const [targetChamber, setTargetChamber] = useState("");
  const [toolName, setToolName] = useState("");
  const [argsTemplate, setArgsTemplate] = useState<Record<string, string>>({});
  const [draftConnections, setDraftConnections] = useState<CapitolExhibitSearchResult[]>([]);

  const catalogQuery = useQuery({ queryKey: ["event-catalog"], queryFn: fetchEventCatalog });

  const toolsQuery = useQuery({
    queryKey: ["chamber-tools", targetChamber],
    queryFn: () => fetchChamberTools(targetChamber),
    enabled: !!targetChamber,
  });
  const tool = toolsQuery.data?.find((t) => t.name === toolName);
  const triggerPayloadFields = catalogQuery.data?.find((e) => e.type === triggerEventType)?.payloadFields;

  const mutation = useMutation({
    mutationFn: async () => {
      const created = await createAutomation({
        title,
        body,
        enabled: true,
        triggerEventType,
        targetChamber,
        toolName,
        argsTemplate,
      });
      await flushDraftConnections(`automation-${created.id}`, draftConnections);
      return created;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["automations"] });
      navigate(resolveChamberPath(`/a/${created.id}`, "automation", shellHosted));
    },
  });

  const canSubmit = title.trim() && triggerEventType.trim() && targetChamber.trim() && toolName.trim();

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

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          {fieldLabel("Trigger event")}
          <TriggerEventPicker
            value={triggerEventType}
            onChange={setTriggerEventType}
            catalog={catalogQuery.data ?? []}
            loading={catalogQuery.isLoading}
            selectClassName={inputClass}
          />
        </div>

        <div className="sm:col-span-2">
          {fieldLabel("Action - call a Chamber's tool")}
          <ChamberToolPicker
            targetChamber={targetChamber}
            toolName={toolName}
            onChamberChange={(chamber) => {
              setTargetChamber(chamber);
              setArgsTemplate({});
            }}
            onToolChange={(nextTool) => {
              setToolName(nextTool);
              setArgsTemplate({});
            }}
            selectClassName={inputClass}
          />
        </div>

        <div className="sm:col-span-2">
          <ArgsEditor
            tool={tool}
            argsTemplate={argsTemplate}
            onChange={setArgsTemplate}
            inputClassName={inputClass}
            triggerPayloadFields={triggerPayloadFields}
          />
        </div>
      </div>

      <ExhibitLinksLayout
        exhibitId={null}
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("automation", r, navigate, shellHosted)}
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
              onClick={() => navigate(resolveChamberPath("/", "automation", shellHosted))}
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
          rows={6}
          placeholder="Notes (optional), [[ to reference an Exhibit"
          className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          renderIcon={(chamber) => getChamberIcon(chamber)}
        />
      </ExhibitLinksLayout>
    </article>
  );
}
