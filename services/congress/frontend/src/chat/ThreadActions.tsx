import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AiThread, UpdateAiThreadRequest } from "@congress/shared-types";
import { ConfirmSheet, showToast } from "@congress/congress-ui";
import { aiThreadQueryKey, aiThreadsQueryKey, deleteAiThread, updateAiThread } from "@/lib/aiApi";

type Sheet = "menu" | "rename" | "delete" | null;

// Rename · Pin · Archive · Delete for one thread, as a docked sheet.
export function ThreadActions({ thread, onDeleted, trigger = "icon" }: { thread: AiThread; onDeleted?: () => void; trigger?: "icon" | "row" }) {
  const queryClient = useQueryClient();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [title, setTitle] = useState(thread.title);

  useEffect(() => {
    if (sheet !== "rename") setTitle(thread.title);
  }, [thread.title, sheet]);

  useEffect(() => {
    if (sheet !== "menu" && sheet !== "rename") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSheet(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheet]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: aiThreadsQueryKey });
    void queryClient.invalidateQueries({ queryKey: aiThreadQueryKey(thread.id) });
  };

  const update = useMutation({
    mutationFn: (patch: UpdateAiThreadRequest) => updateAiThread(thread.id, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(aiThreadQueryKey(thread.id), updated);
      refresh();
    },
    onError: () => showToast("Couldn't update the chat", "error"),
  });

  const remove = useMutation({
    mutationFn: () => deleteAiThread(thread.id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: aiThreadQueryKey(thread.id) });
      void queryClient.invalidateQueries({ queryKey: aiThreadsQueryKey });
      onDeleted?.();
    },
    onError: () => showToast("Couldn't delete the chat", "error"),
  });

  const act = (patch: UpdateAiThreadRequest) => {
    setSheet(null);
    update.mutate(patch);
  };

  return (
    <>
      <button
        type="button"
        className={trigger === "icon" ? "chat-icon-button" : "chat-row-menu"}
        aria-label={`Options for ${thread.title}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setSheet("menu");
        }}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>

      {sheet === "menu" && (
        <div className="confirm-sheet-backdrop" onClick={() => setSheet(null)}>
          <div className="confirm-sheet docked-sheet chat-sheet" role="dialog" aria-modal="true" aria-label="Chat options" onClick={(e) => e.stopPropagation()}>
            <p className="confirm-sheet-title chat-sheet-title">{thread.title}</p>
            <button type="button" className="chat-sheet-item" onClick={() => setSheet("rename")} autoFocus>
              Rename
            </button>
            <button type="button" className="chat-sheet-item" onClick={() => act({ pinned: !thread.pinned })}>
              {thread.pinned ? "Unpin" : "Pin to top"}
            </button>
            <button type="button" className="chat-sheet-item" onClick={() => act({ archived: !thread.archived })}>
              {thread.archived ? "Unarchive" : "Archive"}
            </button>
            <button type="button" className="chat-sheet-item chat-sheet-item--danger" onClick={() => setSheet("delete")}>
              Delete
            </button>
            <button type="button" className="chat-sheet-item chat-sheet-item--cancel" onClick={() => setSheet(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {sheet === "rename" && (
        <div className="confirm-sheet-backdrop" onClick={() => setSheet(null)}>
          <form
            className="confirm-sheet docked-sheet chat-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Rename chat"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const next = title.trim();
              if (next && next !== thread.title) act({ title: next.slice(0, 120) });
              else setSheet(null);
            }}
          >
            <p className="confirm-sheet-title">Rename chat</p>
            <input className="chat-sheet-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} autoFocus enterKeyHint="done" aria-label="Chat title" />
            <div className="confirm-sheet-actions">
              <button type="button" className="tap-target confirm-sheet-cancel" onClick={() => setSheet(null)}>
                Cancel
              </button>
              <button type="submit" className="tap-target chat-sheet-save" disabled={!title.trim()}>
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmSheet
        open={sheet === "delete"}
        title="Delete this chat?"
        message={thread.pendingRunId ? "The reply in progress will be stopped. This can't be undone." : "This can't be undone."}
        onConfirm={() => {
          setSheet(null);
          remove.mutate();
        }}
        onCancel={() => setSheet(null)}
      />
    </>
  );
}
