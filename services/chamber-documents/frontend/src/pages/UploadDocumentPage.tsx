import { useState } from "react";
import { useNavigate } from "react-router-dom";
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
} from "@congress/exhibit-ui";
import { uploadDocument } from "@/lib/api";

export function UploadDocumentPage() {
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const mutation = useMutation({
    mutationFn: () => uploadDocument({ title, description, file: file! }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      navigate(resolveChamberPath(`/d/${created.id}`, "documents", shellHosted));
    },
  });

  return (
    <section>
      <PageHeader title="Upload Document" />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim() && file) mutation.mutate();
        }}
      >
        <FormLabel>Title</FormLabel>
        <FormTextInput autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />

        <FormLabel>File</FormLabel>
        <input
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mb-4 w-full border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink file:mr-3 file:border-0 file:bg-ink/5 file:px-3 file:py-1.5 file:font-mono file:text-xs file:uppercase file:tracking-wide file:text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />

        <FormLabel>Description (optional, [[ to reference an Exhibit)</FormLabel>
        <ExhibitTextarea
          value={description}
          onChange={setDescription}
          rows={8}
          placeholder="Type [[ to reference a note, event, or other Exhibit."
          className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          wrapperClassName="exhibit-field mb-4"
          renderIcon={(chamber) => getChamberIcon(chamber)}
        />

        {mutation.isError && <FormErrorMessage>{(mutation.error as Error).message}</FormErrorMessage>}

        <FormSubmitButton disabled={!title.trim() || !file || mutation.isPending}>
          {mutation.isPending ? "Uploading —" : "Upload Document"}
        </FormSubmitButton>
      </form>
    </section>
  );
}
