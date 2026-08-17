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
import { PRIORITY_LEVELS, type PriorityLevel } from "@congress/shared-types";
import { createLogRule } from "@/lib/api";
import { fetchEventCatalog } from "@/lib/eventCatalog";
import { TriggerEventPicker } from "@/components/TriggerEventPicker";

const inputClass =
  "mb-4 w-full border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent";

export function NewLogRulePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(searchParams.get("name") ?? "");
  const [body, setBody] = useState("");
  const [triggerEventType, setTriggerEventType] = useState("");
  const [minPriority, setMinPriority] = useState<PriorityLevel | "">("");
  const [recordToHistory, setRecordToHistory] = useState(true);
  const [notify, setNotify] = useState(false);
  const [notifyTitleTemplate, setNotifyTitleTemplate] = useState("");
  const [notifyBodyTemplate, setNotifyBodyTemplate] = useState("");
  const [notifyUrlTemplate, setNotifyUrlTemplate] = useState("");
  const [notifyDedupeKeyTemplate, setNotifyDedupeKeyTemplate] = useState("");

  const catalogQuery = useQuery({ queryKey: ["event-catalog"], queryFn: fetchEventCatalog });

  const mutation = useMutation({
    mutationFn: () =>
      createLogRule({
        title,
        body,
        enabled: true,
        triggerEventType,
        minPriority: minPriority || undefined,
        recordToHistory,
        notify,
        notifyTitleTemplate: notify ? notifyTitleTemplate : undefined,
        notifyBodyTemplate: notify ? notifyBodyTemplate || undefined : undefined,
        notifyUrlTemplate: notify ? notifyUrlTemplate || undefined : undefined,
        notifyDedupeKeyTemplate: notify ? notifyDedupeKeyTemplate : undefined,
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["log-rules"] });
      navigate(resolveChamberPath(`/r/${created.id}`, "logs", shellHosted));
    },
  });

  const canSubmit =
    title.trim() &&
    triggerEventType.trim() &&
    (recordToHistory || notify) &&
    (!notify || (notifyTitleTemplate.trim() && notifyDedupeKeyTemplate.trim()));

  return (
    <section>
      <PageHeader title="New Log Rule" />

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

        <FormLabel>Minimum priority (optional - only matches events at or above this)</FormLabel>
        <select value={minPriority} onChange={(e) => setMinPriority(e.target.value as PriorityLevel | "")} className={inputClass}>
          <option value="">— No threshold —</option>
          {PRIORITY_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>

        <label className="mb-4 flex items-center gap-2 font-mono text-sm text-ink">
          <input type="checkbox" checked={recordToHistory} onChange={(e) => setRecordToHistory(e.target.checked)} />
          Record to history
        </label>

        <label className="mb-4 flex items-center gap-2 font-mono text-sm text-ink">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Push a notification
        </label>

        {notify && (
          <>
            <FormLabel>Notification title ({"{{"}payload.x{"}}"} interpolated)</FormLabel>
            <input value={notifyTitleTemplate} onChange={(e) => setNotifyTitleTemplate(e.target.value)} className={inputClass} />

            <FormLabel>Notification body (optional)</FormLabel>
            <input value={notifyBodyTemplate} onChange={(e) => setNotifyBodyTemplate(e.target.value)} className={inputClass} />

            <FormLabel>Link (optional, e.g. {"{{"}payload.url{"}}"})</FormLabel>
            <input value={notifyUrlTemplate} onChange={(e) => setNotifyUrlTemplate(e.target.value)} className={inputClass} />

            <FormLabel>
              Dedupe key ({"{{"}payload.x{"}}"} interpolated - reused if this rule notifies again for the same underlying thing, so
              it updates the existing notification in place instead of piling up duplicates)
            </FormLabel>
            <input value={notifyDedupeKeyTemplate} onChange={(e) => setNotifyDedupeKeyTemplate(e.target.value)} className={inputClass} />
          </>
        )}

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

        <FormSubmitButton disabled={!canSubmit || mutation.isPending}>{mutation.isPending ? "Creating —" : "Create Log Rule"}</FormSubmitButton>
      </form>
    </section>
  );
}
