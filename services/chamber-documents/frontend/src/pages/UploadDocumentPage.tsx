import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useExhibitPicker, ExhibitPickerDropdown } from "@congress/exhibit-ui";
import { uploadDocument } from "@/lib/api";
import { getChamberIcon } from "@/components/ChamberIcon";

export function UploadDocumentPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const picker = useExhibitPicker({ value: description, onChange: setDescription });

  const mutation = useMutation({
    mutationFn: () => uploadDocument({ title, description, file: file! }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      navigate(`/d/${created.id}`);
    },
  });

  return (
    <section>
      <h2 className="mb-6 border-b border-dust pb-4 font-display text-3xl text-ink">Upload Document</h2>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim() && file) mutation.mutate();
        }}
      >
        <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">Title</label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mb-4 w-full border border-dust bg-parchment px-3 py-2 font-display text-xl text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />

        <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">File</label>
        <input
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mb-4 w-full border border-dust bg-parchment px-3 py-2 font-mono text-sm text-ink file:mr-3 file:border-0 file:bg-ink/5 file:px-3 file:py-1.5 file:font-mono file:text-xs file:uppercase file:tracking-wide file:text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />

        <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">
          Description (optional, [[ to reference an Exhibit)
        </label>
        <div className="exhibit-field mb-4">
          <textarea
            {...picker.fieldProps}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={8}
            placeholder="Type [[ to reference a note, event, or other Exhibit."
            className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          />
          <ExhibitPickerDropdown
            picker={picker}
            renderIcon={(chamber) => getChamberIcon(chamber)}
            className="exhibit-picker-dropdown"
          />
        </div>

        {mutation.isError && (
          <p className="mb-4 font-mono text-sm text-alert">{(mutation.error as Error).message}</p>
        )}

        <button
          type="submit"
          disabled={!title.trim() || !file || mutation.isPending}
          className="border border-accent px-4 py-2 font-mono text-xs uppercase tracking-wide text-accent hover:bg-accent hover:text-parchment disabled:opacity-50"
        >
          {mutation.isPending ? "Uploading —" : "Upload Document"}
        </button>
      </form>
    </section>
  );
}
