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
import { createItem, quickCreateItemExhibit } from "@/lib/api";

export function NewItemPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [name, setName] = useState(searchParams.get("name") ?? "");
  const [body, setBody] = useState("");

  const mutation = useMutation({
    mutationFn: () => createItem({ name, body }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
      navigate(resolveChamberPath(`/i/${created.id}`, "__CHAMBER_NAME__", shellHosted));
    },
  });

  async function onCreateExhibit(title: string) {
    const result = await quickCreateItemExhibit(title);
    queryClient.invalidateQueries({ queryKey: ["items"] });
    return result;
  }

  return (
    <section>
      <PageHeader title="New Item" />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) mutation.mutate();
        }}
      >
        <FormLabel>Name</FormLabel>
        <FormTextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} />

        <FormLabel>Body (optional, [[ to reference an Exhibit)</FormLabel>
        <ExhibitTextarea
          value={body}
          onChange={setBody}
          rows={10}
          className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          wrapperClassName="exhibit-field mb-4"
          renderIcon={(chamber) => getChamberIcon(chamber)}
          onCreate={onCreateExhibit}
        />

        {mutation.isError && <FormErrorMessage>{(mutation.error as Error).message}</FormErrorMessage>}

        <FormSubmitButton disabled={!name.trim() || mutation.isPending}>
          {mutation.isPending ? "Creating —" : "Create Item"}
        </FormSubmitButton>
      </form>
    </section>
  );
}
