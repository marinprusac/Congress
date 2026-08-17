import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChamberHeader,
  ExhibitActionBar,
  ExhibitAnnotatedText,
  ExhibitMarkdown,
  ExhibitTextarea,
  CapitolMark,
  getChamberIcon,
  stripFrontmatter,
} from "@congress/congress-ui";
import { fetchSharedDetail, fetchSharedContent, sharedDownloadUrl, updateSharedContent } from "@/lib/sharedApi";

function formatDepthLabel(depth: number): string {
  return depth === 0 ? "Root" : `Depth ${depth}`;
}

export function SharedViewPage() {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const exhibitParam = searchParams.get("exhibit");
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

  // A "shared" badge on an inherited exhibit links here with ?exhibit= so
  // this opens straight on that exhibit instead of always defaulting to the
  // share's root - falls back to the root when the param is missing or
  // isn't actually in this share's closure.
  const exhibitParamInClosure =
    exhibitParam && detailQuery.data?.closure.some((entry) => entry.id === exhibitParam) ? exhibitParam : null;
  const activeId = selectedId ?? exhibitParamInClosure ?? detailQuery.data?.rootId ?? null;
  const activeEntry = detailQuery.data?.closure.find((entry) => entry.id === activeId);

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
      <div className="flex min-h-screen items-center justify-center bg-parchment pt-[env(safe-area-inset-top)] font-mono text-sm text-dust">
        Loading —
      </div>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-parchment px-6 pt-[env(safe-area-inset-top)] text-center text-ink">
        <p className="font-mono text-sm text-alert">
          This share link is invalid, expired, or has been revoked.
        </p>
      </div>
    );
  }

  const share = detailQuery.data;
  const content = contentQuery.data;
  const resolveUrl = `/capitol/shared/${token}/exhibits/resolve`;
  const isMarkdown = activeEntry?.contentFormat === "markdown";

  function selectExhibit(id: string) {
    setSelectedId(id);
    setEditing(false);
  }

  return (
    <div className="min-h-screen bg-parchment pt-[env(safe-area-inset-top)] text-ink">
      <ChamberHeader
        icon={<CapitolMark className="h-8 w-8 text-ink" />}
        title={share.label || "Shared exhibits"}
        showSearch={false}
      />

      <div className="shared-view-layout">
        <nav className="shared-view-nav">
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
                    onClick={() => selectExhibit(entry.id)}
                    className={`tap-target block w-full border-b border-dust py-2 text-left font-mono text-sm ${
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

        <main className="shared-view-main">
          {contentQuery.isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
          {!contentQuery.isLoading && (contentQuery.isError || !content) && (
            <p className="font-mono text-sm text-alert">Failed to load this exhibit.</p>
          )}
          {content && (
            <article>
              <div className="mb-6 border-b border-dust pb-4">
                {editing ? (
                  <input
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    className="w-full font-display text-3xl text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
                  />
                ) : (
                  <h2 className="font-display text-3xl text-ink">{content.name}</h2>
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
                <>
                  <ExhibitTextarea
                    value={draftBody}
                    onChange={setDraftBody}
                    rows={20}
                    className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
                    renderIcon={(chamber) => getChamberIcon(chamber)}
                  />
                  <ExhibitActionBar>
                    <button
                      onClick={() => updateMutation.mutate({ title: draftTitle, body: draftBody })}
                      className="tap-target text-accent hover:underline"
                    >
                      Save
                    </button>
                    <button onClick={() => setEditing(false)} className="tap-target text-slate hover:underline">
                      Cancel
                    </button>
                  </ExhibitActionBar>
                </>
              ) : (
                <>
                  {isMarkdown ? (
                    <ExhibitMarkdown
                      body={stripFrontmatter(content.body)}
                      resolveUrl={resolveUrl}
                      onNavigate={(r) => selectExhibit(r.id)}
                    />
                  ) : (
                    <ExhibitAnnotatedText
                      text={content.body}
                      resolveUrl={resolveUrl}
                      renderIcon={(chamber) => getChamberIcon(chamber)}
                      onNavigate={(r) => selectExhibit(r.id)}
                      className="whitespace-pre-wrap"
                    />
                  )}
                  {share.permission === "edit" && (
                    <ExhibitActionBar>
                      <button onClick={() => setEditing(true)} className="tap-target text-accent hover:underline">
                        Edit
                      </button>
                    </ExhibitActionBar>
                  )}
                </>
              )}
            </article>
          )}
        </main>
      </div>
    </div>
  );
}
