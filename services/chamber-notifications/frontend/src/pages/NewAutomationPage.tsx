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
import { createAutomation } from "@/lib/api";
import { fetchEventCatalog } from "@/lib/eventCatalog";

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
  const [actionKind, setActionKind] = useState<"push" | "withdraw">("push");
  const [actionTitleTemplate, setActionTitleTemplate] = useState("");
  const [actionBodyTemplate, setActionBodyTemplate] = useState("");
  const [actionUrlTemplate, setActionUrlTemplate] = useState("");
  const [actionDedupeKeyTemplate, setActionDedupeKeyTemplate] = useState("");

  const catalogQuery = useQuery({ queryKey: ["event-catalog"], queryFn: fetchEventCatalog });

  const mutation = useMutation({
    mutationFn: () =>
      createAutomation({
        title,
        body,
        enabled: true,
        triggerEventType,
        actionKind,
        actionTitleTemplate: actionTitleTemplate || undefined,
        actionBodyTemplate: actionBodyTemplate || undefined,
        actionUrlTemplate: actionUrlTemplate || undefined,
        actionDedupeKeyTemplate,
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["automations"] });
      navigate(resolveChamberPath(`/a/${created.id}`, "notifications", shellHosted));
    },
  });

  const canSubmit =
    title.trim() && triggerEventType.trim() && actionDedupeKeyTemplate.trim() && (actionKind === "withdraw" || actionTitleTemplate.trim());

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

        <FormLabel>Trigger event type</FormLabel>
        <input
          list="event-catalog"
          value={triggerEventType}
          onChange={(e) => setTriggerEventType(e.target.value)}
          placeholder="e.g. tasks.due_soon"
          className={inputClass}
        />
        <datalist id="event-catalog">
          {catalogQuery.data?.map((entry) => (
            <option key={`${entry.chamber}:${entry.type}`} value={entry.type}>
              {entry.chamber} — {entry.label}
            </option>
          ))}
        </datalist>

        <FormLabel>Action</FormLabel>
        <select value={actionKind} onChange={(e) => setActionKind(e.target.value as "push" | "withdraw")} className={inputClass}>
          <option value="push">Push a notification</option>
          <option value="withdraw">Withdraw a notification</option>
        </select>

        {actionKind === "push" && (
          <>
            <FormLabel>Notification title ({"{{"}payload.x{"}}"} interpolated)</FormLabel>
            <input
              value={actionTitleTemplate}
              onChange={(e) => setActionTitleTemplate(e.target.value)}
              className={inputClass}
            />

            <FormLabel>Notification body (optional)</FormLabel>
            <input value={actionBodyTemplate} onChange={(e) => setActionBodyTemplate(e.target.value)} className={inputClass} />

            <FormLabel>Link (optional, e.g. {"{{"}payload.url{"}}"})</FormLabel>
            <input value={actionUrlTemplate} onChange={(e) => setActionUrlTemplate(e.target.value)} className={inputClass} />
          </>
        )}

        <FormLabel>Dedupe key ({"{{"}payload.x{"}}"} interpolated - must match the automation this withdraws, if any)</FormLabel>
        <input
          value={actionDedupeKeyTemplate}
          onChange={(e) => setActionDedupeKeyTemplate(e.target.value)}
          className={inputClass}
        />

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
