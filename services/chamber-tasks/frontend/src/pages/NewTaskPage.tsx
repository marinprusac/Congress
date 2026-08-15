import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { createTask, quickCreateTaskExhibit } from "@/lib/api";

export function NewTaskPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [name, setName] = useState(searchParams.get("name") ?? "");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");

  const mutation = useMutation({
    mutationFn: () => createTask({ name, description, dueDate: dueDate || null }),
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
    <section>
      <PageHeader title="New Task" />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) mutation.mutate();
        }}
      >
        <FormLabel>Name</FormLabel>
        <FormTextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} />

        <FormLabel>Due date (optional)</FormLabel>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="mb-4 border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />

        <FormLabel>Description (optional, [[ to reference an Exhibit)</FormLabel>
        <ExhibitTextarea
          value={description}
          onChange={setDescription}
          rows={10}
          className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          wrapperClassName="exhibit-field mb-4"
          renderIcon={(chamber) => getChamberIcon(chamber)}
          onCreate={onCreateExhibit}
        />

        {mutation.isError && <FormErrorMessage>{(mutation.error as Error).message}</FormErrorMessage>}

        <FormSubmitButton disabled={!name.trim() || mutation.isPending}>
          {mutation.isPending ? "Creating —" : "Create Task"}
        </FormSubmitButton>
      </form>
    </section>
  );
}
