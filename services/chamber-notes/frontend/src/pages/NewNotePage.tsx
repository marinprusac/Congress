import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useExhibitPicker, ExhibitPickerDropdown } from "@congress/exhibit-ui";
import { createNote } from "@/lib/api";
import { getChamberIcon } from "@/components/ChamberIcon";

export function NewNotePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(searchParams.get("title") ?? "");
  const [content, setContent] = useState("");
  const picker = useExhibitPicker({ value: content, onChange: setContent });

  const mutation = useMutation({
    mutationFn: () => createNote({ title, content }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      navigate(`/n/${created.id}`);
    },
  });

  return (
    <section>
      <h2 className="mb-6 border-b border-dust pb-4 font-display text-3xl text-ink">New Note</h2>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) mutation.mutate();
        }}
      >
        <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">Title</label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mb-4 w-full border border-dust bg-parchment px-3 py-2 font-display text-xl text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />

        <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">
          Content (Markdown, optional YAML frontmatter, [[ to reference an Exhibit)
        </label>
        <textarea
          {...picker.fieldProps}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={16}
          placeholder={"---\ntags: []\n---\nStart writing. Type [[ to reference a note, event, or other Exhibit."}
          className="mb-4 w-full border border-dust bg-parchment p-3 font-mono text-base text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
        <ExhibitPickerDropdown
          picker={picker}
          renderIcon={(chamber) => getChamberIcon(chamber)}
          className="exhibit-picker-dropdown"
        />

        {mutation.isError && (
          <p className="mb-4 font-mono text-sm text-alert">{(mutation.error as Error).message}</p>
        )}

        <button
          type="submit"
          disabled={!title.trim() || mutation.isPending}
          className="border border-accent px-4 py-2 font-mono text-xs uppercase tracking-wide text-accent hover:bg-accent hover:text-parchment disabled:opacity-50"
        >
          {mutation.isPending ? "Creating —" : "Create Note"}
        </button>
      </form>
    </section>
  );
}
