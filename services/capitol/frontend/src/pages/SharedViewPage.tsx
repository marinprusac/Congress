import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CapitolExhibitResolveResult, ShareClosureEntry } from "@congress/shared-types";
import { ExhibitChip, extractExhibitTokens, splitExhibitText, parseExhibitToken } from "@congress/exhibit-ui";
import { fetchSharedDetail, fetchSharedContent, sharedDownloadUrl, updateSharedContent } from "@/lib/sharedApi";
import { CapitolMark } from "@/components/icons";

function formatDepthLabel(depth: number): string {
  return depth === 0 ? "Root" : `Depth ${depth}`;
}

// Resolves [[ references against the closure already fetched with the share
// detail, rather than hitting a resolve endpoint again - the closure is a
// complete, authoritative membership list, and clicking a reference just
// switches the sidebar selection (there's no chamber frontend for a
// tokenless recipient to navigate into).
function SharedBody({
  text,
  closure,
  onSelect,
}: {
  text: string;
  closure: ShareClosureEntry[];
  onSelect: (id: string) => void;
}) {
  const closureById = new Map(closure.map((e) => [e.id, e]));
  const segments = splitExhibitText(text);

  return (
    <span className="whitespace-pre-wrap">
      {segments.map((segment, index) => {
        if (segment.type === "text") return <span key={index}>{segment.value}</span>;
        const parsed = parseExhibitToken(segment.token);
        const entry = parsed ? closureById.get(parsed.id) : undefined;
        const result: CapitolExhibitResolveResult = entry
          ? { id: entry.id, chamber: entry.chamber, name: entry.name, url: "#" }
          : { id: parsed?.id ?? segment.token, chamber: parsed?.chamber ?? "", unavailable: true };
        return (
          <ExhibitChip
            key={index}
            result={result}
            fallbackLabel={segment.label}
            className="exhibit-chip"
            onNavigate={(r) => onSelect(r.id)}
          />
        );
      })}
    </span>
  );
}

export function SharedViewPage() {
  const { token } = useParams<{ token: string }>();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");

  const detailQuery = useQuery({
    queryKey: ["shared", token, "detail"],
    queryFn: () => fetchSharedDetail(token!),
    enabled: Boolean(token),
  });

  const activeId = selectedId ?? detailQuery.data?.rootId ?? null;

  const contentQuery = useQuery({
    queryKey: ["shared", token, "content", activeId],
    queryFn: () => fetchSharedContent(token!, activeId!),
    enabled: Boolean(token && activeId),
  });

  const updateMutation = useMutation({
    mutationFn: (input: { title: string; body: string }) => updateSharedContent(token!, activeId!, input),
    onSuccess: (updated) => {
      if (updated) queryClient.setQueryData(["shared", token, "content", activeId], updated);
      setEditing(false);
    },
  });

  useEffect(() => {
    if (contentQuery.data && !editing) {
      setDraftTitle(contentQuery.data.name);
      setDraftBody(contentQuery.data.body);
    }
  }, [contentQuery.data, editing]);

  if (!token) return null;

  if (detailQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-parchment font-mono text-sm text-dust">
        Loading —
      </div>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-parchment px-6 text-center text-ink">
        <p className="font-mono text-sm text-alert">
          This share link is invalid, expired, or has been revoked.
        </p>
      </div>
    );
  }

  const share = detailQuery.data;
  const content = contentQuery.data;

  return (
    <div className="min-h-screen bg-parchment text-ink">
      <header className="flex items-center gap-3 border-b border-dust px-6 py-6">
        <CapitolMark className="h-6 w-6 text-ink" />
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-dust">Congress — Shared</p>
          <h1 className="font-display text-2xl">{share.label || "Shared exhibits"}</h1>
        </div>
      </header>

      <div className="mx-auto flex max-w-5xl gap-8 px-6 py-10">
        <nav className="w-64 shrink-0 border-r border-dust pr-4">
          <h2 className="mb-2 font-mono text-xs uppercase tracking-wide text-dust">
            Contents ({share.closure.length})
          </h2>
          <ul>
            {share.closure
              .slice()
              .sort((a, b) => a.depth - b.depth)
              .map((entry) => (
                <li key={entry.id}>
                  <button
                    onClick={() => {
                      setSelectedId(entry.id);
                      setEditing(false);
                    }}
                    className={`block w-full border-b border-dust py-2 text-left font-mono text-sm ${
                      entry.id === activeId ? "text-accent" : "text-ink hover:text-accent"
                    }`}
                  >
                    <span className="block text-xs uppercase text-dust">
                      {entry.chamber} · {formatDepthLabel(entry.depth)}
                    </span>
                    {entry.name}
                  </button>
                </li>
              ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1">
          {contentQuery.isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
          {!contentQuery.isLoading && (contentQuery.isError || !content) && (
            <p className="font-mono text-sm text-alert">Failed to load this exhibit.</p>
          )}
          {content && (
            <article>
              <div className="mb-6 flex items-start justify-between gap-4 border-b border-dust pb-4">
                {editing ? (
                  <input
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    className="min-w-0 flex-1 font-display text-3xl text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
                  />
                ) : (
                  <h2 className="min-w-0 flex-1 font-display text-3xl text-ink">{content.name}</h2>
                )}
                {share.permission === "edit" && (
                  <div className="flex shrink-0 gap-3 font-mono text-xs uppercase tracking-wide">
                    {editing ? (
                      <>
                        <button
                          onClick={() => updateMutation.mutate({ title: draftTitle, body: draftBody })}
                          className="text-accent hover:underline"
                        >
                          Save
                        </button>
                        <button onClick={() => setEditing(false)} className="text-slate hover:underline">
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button onClick={() => setEditing(true)} className="text-accent hover:underline">
                        Edit
                      </button>
                    )}
                  </div>
                )}
              </div>

              {updateMutation.isError && (
                <p className="mb-4 font-mono text-sm text-alert">Failed to save changes.</p>
              )}

              {content.isBinary && content.downloadUrl && (
                <a
                  href={sharedDownloadUrl(token, content.id)}
                  download
                  className="mb-6 inline-block border border-accent px-4 py-2 font-mono text-xs uppercase tracking-wide text-accent hover:bg-accent hover:text-parchment"
                >
                  Download file
                </a>
              )}

              {editing ? (
                <textarea
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                  rows={20}
                  className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
                />
              ) : (
                <SharedBody
                  text={content.body}
                  closure={share.closure}
                  onSelect={(id) => {
                    setSelectedId(id);
                    setEditing(false);
                  }}
                />
              )}
            </article>
          )}
        </main>
      </div>
    </div>
  );
}
