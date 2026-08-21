import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExhibitTextarea, getChamberIcon, useShellHosted, resolveChamberPath, PageHeader, FormLabel, FormTextInput, FormErrorMessage, FormSubmitButton } from "@congress/congress-ui";
import { createDirective } from "@/lib/api";

export function NewDirectivePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(searchParams.get("name") ?? "");
  const [body, setBody] = useState("");
  const [timeBased, setTimeBased] = useState(true);

  const mutation = useMutation({
    mutationFn: () => createDirective({ title, body, enabled: true, timeBased }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["directives"] });
      navigate(resolveChamberPath(`/d/${created.id}`, "deputy", shellHosted));
    },
  });

  const canSubmit = title.trim().length > 0;

  return (
    <section>
      <PageHeader title="New Directive" />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) mutation.mutate();
        }}
      >
        <FormLabel>Title</FormLabel>
        <FormTextInput autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Morning overdue-task check" />

        <FormLabel>Instructions ([[ to reference an Exhibit)</FormLabel>
        <ExhibitTextarea
          value={body}
          onChange={setBody}
          rows={8}
          className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          wrapperClassName="exhibit-field mb-4"
          renderIcon={(chamber) => getChamberIcon(chamber)}
          placeholder="Plain English - what should Deputy check or do, and when. Purely time-based ('every morning...') and event-reactive directives both go here."
        />

        <label className="mb-4 flex items-center gap-2 font-mono text-xs uppercase tracking-wide text-slate">
          <input type="checkbox" checked={timeBased} onChange={(e) => setTimeBased(e.target.checked)} />
          Wake on schedule, even with no new events
        </label>

        {mutation.isError && <FormErrorMessage>{(mutation.error as Error).message}</FormErrorMessage>}

        <FormSubmitButton disabled={!canSubmit || mutation.isPending}>{mutation.isPending ? "Creating —" : "Create Directive"}</FormSubmitButton>
      </form>
    </section>
  );
}
