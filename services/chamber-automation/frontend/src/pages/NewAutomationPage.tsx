import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExhibitTextarea,
  getChamberIcon,
  useShellHosted,
  resolveChamberPath,
  PageHeader,
  FormLabel,
  FormTextInput,
  FormErrorMessage,
  FormSubmitButton,
} from "@congress/congress-ui";
import { createAutomation, fetchChamberTools } from "@/lib/api";
import { fetchEventCatalog } from "@/lib/eventCatalog";
import { TriggerEventPicker } from "@/components/TriggerEventPicker";
import { ChamberToolPicker } from "@/components/ChamberToolPicker";
import { ArgsEditor } from "@/components/ArgsEditor";

const inputClass =
  "mb-4 w-full border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent";

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

  const catalogQuery = useQuery({ queryKey: ["event-catalog"], queryFn: fetchEventCatalog });

  const mutation = useMutation({
    mutationFn: () =>
      createAutomation({
        title,
        body,
        enabled: true,
        triggerEventType,
        targetChamber,
        toolName,
        argsTemplate,
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["automations"] });
      navigate(resolveChamberPath(`/a/${created.id}`, "automation", shellHosted));
    },
  });

  const canSubmit = title.trim() && triggerEventType.trim() && targetChamber.trim() && toolName.trim();

  return (
    <section>
      <PageHeader title="New Automation" />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) mutation.mutate();
        }}
      >
        <FormLabel>Title</FormLabel>
        <FormTextInput autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />

        <FormLabel>Trigger event</FormLabel>
        <TriggerEventPicker
          value={triggerEventType}
          onChange={setTriggerEventType}
          catalog={catalogQuery.data ?? []}
          loading={catalogQuery.isLoading}
          selectClassName={inputClass}
        />

        <FormLabel>Action - call a Chamber's tool</FormLabel>
        <ChamberToolPicker
          targetChamber={targetChamber}
          toolName={toolName}
          onChamberChange={(chamber) => {
            setTargetChamber(chamber);
            setArgsTemplate({});
          }}
          onToolChange={(tool) => {
            setToolName(tool);
            setArgsTemplate({});
          }}
          selectClassName={inputClass}
        />

        <ChamberToolArgs targetChamber={targetChamber} toolName={toolName} argsTemplate={argsTemplate} onChange={setArgsTemplate} />

        <FormLabel>Notes (optional, [[ to reference an Exhibit)</FormLabel>
        <ExhibitTextarea
          value={body}
          onChange={setBody}
          rows={6}
          className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          wrapperClassName="exhibit-field mb-4"
          renderIcon={(chamber) => getChamberIcon(chamber)}
        />

        {mutation.isError && <FormErrorMessage>{(mutation.error as Error).message}</FormErrorMessage>}

        <FormSubmitButton disabled={!canSubmit || mutation.isPending}>
          {mutation.isPending ? "Creating —" : "Create Automation"}
        </FormSubmitButton>
      </form>
    </section>
  );
}

// Split out so it can look up the selected tool's own schema without
// ChamberToolPicker (a controlled pair of <select>s) needing to expose its
// internal tools query to the parent form.
function ChamberToolArgs({
  targetChamber,
  toolName,
  argsTemplate,
  onChange,
}: {
  targetChamber: string;
  toolName: string;
  argsTemplate: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const toolsQuery = useQuery({
    queryKey: ["chamber-tools", targetChamber],
    queryFn: () => fetchChamberTools(targetChamber),
    enabled: !!targetChamber,
  });
  const tool = toolsQuery.data?.find((t) => t.name === toolName);
  return <ArgsEditor tool={tool} argsTemplate={argsTemplate} onChange={onChange} inputClassName={inputClass} />;
}
