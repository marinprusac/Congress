import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExhibitTextarea, getChamberIcon, useShellHosted, resolveChamberPath } from "@congress/exhibit-ui";
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
      <h2 className="mb-6 border-b border-dust pb-4 font-display text-3xl text-ink">New Task</h2>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) mutation.mutate();
        }}
      >
        <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">Name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-4 w-full border border-dust bg-parchment px-3 py-2 font-display text-xl text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />

        <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">Due date (optional)</label>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="mb-4 border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />

        <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">
          Description (optional, [[ to reference an Exhibit)
        </label>
        <ExhibitTextarea
          value={description}
          onChange={setDescription}
          rows={10}
          className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          wrapperClassName="exhibit-field mb-4"
          renderIcon={(chamber) => getChamberIcon(chamber)}
          onCreate={onCreateExhibit}
        />

        {mutation.isError && <p className="mb-4 font-mono text-sm text-alert">{(mutation.error as Error).message}</p>}

        <button
          type="submit"
          disabled={!name.trim() || mutation.isPending}
          className="border border-accent px-4 py-2 font-mono text-xs uppercase tracking-wide text-accent hover:bg-accent hover:text-parchment disabled:opacity-50"
        >
          {mutation.isPending ? "Creating —" : "Create Task"}
        </button>
      </form>
    </section>
  );
}
