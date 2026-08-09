import { useQuery } from "@tanstack/react-query";
import { fetchDocuments } from "@/lib/api";

const WIDGET_LIMIT = 6;

// Rendered chrome-free — this page is embedded directly as Capitol's
// homepage widget for this Chamber (via an iframe at chamber.routes.widget),
// not visited on its own. Links use target="_top" so a click breaks out of
// the iframe and navigates Capitol's own tab, rather than routing inside
// the small embedded frame.
export function WidgetPreviewPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["documents"],
    queryFn: fetchDocuments,
  });

  const recent = data?.slice(0, WIDGET_LIMIT);

  return (
    <div className="flex h-screen flex-col bg-parchment p-3 text-ink">
      <div className="mb-2 flex shrink-0 items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-dust">Recent</p>
        <a
          href="/documents/new"
          target="_top"
          className="font-mono text-[10px] uppercase tracking-wide text-accent hover:underline"
        >
          + Upload
        </a>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && <p className="font-mono text-xs text-dust">Loading —</p>}
        {isError && <p className="font-mono text-xs text-alert">Documents unavailable.</p>}
        {!isLoading && !isError && recent?.length === 0 && (
          <p className="font-mono text-xs text-dust">— No documents —</p>
        )}
        {!isLoading &&
          !isError &&
          recent?.map((doc) => (
            <a
              key={doc.id}
              href={`/documents/d/${doc.id}`}
              target="_top"
              className="block border-b border-dust py-1.5 font-display text-sm text-ink first:pt-0 last:border-b-0 hover:text-accent"
            >
              {doc.title}
            </a>
          ))}
      </div>
    </div>
  );
}
