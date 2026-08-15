import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExhibitTextarea,
  ExhibitActionBar,
  ExhibitAnnotatedText,
  ExhibitSharingBadge,
  ExhibitLinksLayout,
  ShareControl,
  navigateToExhibit,
  getChamberIcon,
  useShellHosted,
  resolveChamberPath,
  confirmDelete,
} from "@congress/congress-ui";
import { fetchItem, updateItem, deleteItem, quickCreateItemExhibit } from "@/lib/api";

export function ItemViewPage() {
  const { id } = useParams<{ id: string }>();
  const itemId = Number(id);
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftBody, setDraftBody] = useState("");

  const itemQuery = useQuery({
    queryKey: ["item", itemId],
    queryFn: () => fetchItem(itemId),
    enabled: Number.isInteger(itemId),
  });

  const updateMutation = useMutation({
    mutationFn: (input: { name: string; body: string }) => updateItem(itemId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(["item", itemId], updated);
      queryClient.invalidateQueries({ queryKey: ["items"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteItem(itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
      navigate(resolveChamberPath("/", "__CHAMBER_NAME__", shellHosted));
    },
  });

  useEffect(() => {
    if (itemQuery.data && !editing) {
      setDraftName(itemQuery.data.name);
      setDraftBody(itemQuery.data.body);
    }
  }, [itemQuery.data, editing]);

  if (!Number.isInteger(itemId)) return <p className="font-mono text-sm text-alert">Invalid item id.</p>;
  if (itemQuery.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (itemQuery.isError || !itemQuery.data) return <p className="font-mono text-sm text-alert">Item not found.</p>;

  const item = itemQuery.data;

  async function onCreateExhibit(title: string) {
    const result = await quickCreateItemExhibit(title);
    queryClient.invalidateQueries({ queryKey: ["items"] });
    return result;
  }

  function save() {
    updateMutation.mutate({ name: draftName, body: draftBody }, { onSuccess: () => setEditing(false) });
  }

  return (
    <article>
      <div className="mb-6 border-b border-dust pb-4">
        {editing ? (
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            className="w-full font-display text-3xl text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          />
        ) : (
          <h2 className="flex min-w-0 items-center gap-3 font-display text-3xl text-ink">
            <span>{item.name}</span>
            <ExhibitSharingBadge exhibitId={`item-${itemId}`} className="exhibit-sharing-badge" />
          </h2>
        )}
      </div>

      {updateMutation.isError && (
        <p className="mb-4 font-mono text-sm text-alert">{(updateMutation.error as Error).message}</p>
      )}

      <ExhibitLinksLayout
        exhibitId={`item-${itemId}`}
        emptyBacklinksLabel="Nothing references this item"
        emptyFrontlinksLabel="This item references nothing"
        renderIcon={(chamber) => getChamberIcon(chamber)}
        onNavigate={(r) => navigateToExhibit("__CHAMBER_NAME__", r, navigate, shellHosted)}
        editable
        onCreateReference={onCreateExhibit}
      >
        {editing ? (
          <ExhibitTextarea
            value={draftBody}
            onChange={setDraftBody}
            rows={12}
            className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
            renderIcon={(chamber) => getChamberIcon(chamber)}
            onCreate={onCreateExhibit}
          />
        ) : item.body ? (
          <ExhibitAnnotatedText
            text={item.body}
            renderIcon={(chamber) => getChamberIcon(chamber)}
            onNavigate={(r) => navigateToExhibit("__CHAMBER_NAME__", r, navigate, shellHosted)}
            className="whitespace-pre-wrap text-base text-ink"
          />
        ) : (
          <p className="whitespace-pre-wrap text-base text-dust">— No body —</p>
        )}

        <ExhibitActionBar>
          {editing ? (
            <>
              <button onClick={save} className="tap-target text-accent hover:underline">
                Save
              </button>
              <button onClick={() => setEditing(false)} className="tap-target text-slate hover:underline">
                Cancel
              </button>
            </>
          ) : (
            <>
              <ShareControl chamber="__CHAMBER_NAME__" exhibitId={`item-${itemId}`} exhibitName={item.name} />
              <button onClick={() => setEditing(true)} className="tap-target text-accent hover:underline">
                Edit
              </button>
              <button
                onClick={() => {
                  if (confirmDelete(item.name)) deleteMutation.mutate();
                }}
                className="tap-target text-alert hover:underline"
              >
                Delete
              </button>
            </>
          )}
        </ExhibitActionBar>
      </ExhibitLinksLayout>
    </article>
  );
}
