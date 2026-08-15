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
import { createNote, quickCreateNoteExhibit } from "@/lib/api";

export function NewNotePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(searchParams.get("title") ?? "");
  const [content, setContent] = useState("");

  const mutation = useMutation({
    mutationFn: () => createNote({ title, content }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      navigate(resolveChamberPath(`/n/${created.id}`, "notes", shellHosted));
    },
  });

  async function onCreateExhibit(refTitle: string) {
    const result = await quickCreateNoteExhibit(refTitle);
    queryClient.invalidateQueries({ queryKey: ["notes"] });
    return result;
  }

  return (
    <section>
      <PageHeader title="New Note" />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) mutation.mutate();
        }}
      >
        <FormLabel>Title</FormLabel>
        <FormTextInput autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />

        <FormLabel>Content (Markdown, optional YAML frontmatter, [[ to reference an Exhibit)</FormLabel>
        <ExhibitTextarea
          value={content}
          onChange={setContent}
          rows={16}
          placeholder={"---\ntags: []\n---\nStart writing. Type [[ to reference a note, event, or other Exhibit."}
          className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          wrapperClassName="exhibit-field mb-4"
          renderIcon={(chamber) => getChamberIcon(chamber)}
          onCreate={onCreateExhibit}
        />

        {mutation.isError && <FormErrorMessage>{(mutation.error as Error).message}</FormErrorMessage>}

        <FormSubmitButton disabled={!title.trim() || mutation.isPending}>
          {mutation.isPending ? "Creating —" : "Create Note"}
        </FormSubmitButton>
      </form>
    </section>
  );
}
