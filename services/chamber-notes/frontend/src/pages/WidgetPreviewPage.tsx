import { useQuery } from "@tanstack/react-query";
import { fetchPinnedNotes } from "@/lib/api";

// Rendered chrome-free — this page is embedded directly as Capitol's
// homepage widget for this Chamber (via an iframe at chamber.routes.widget),
// not visited on its own. Links use target="_top" so a click breaks out of
// the iframe and navigates Capitol's own tab, rather than routing inside
// the small embedded frame.
export function WidgetPreviewPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["notes", "pinned"],
    queryFn: fetchPinnedNotes,
  });

  return (
    <div className="flex h-screen flex-col bg-parchment p-3 text-ink">
      <p className="mb-2 shrink-0 font-mono text-[10px] uppercase tracking-widest text-dust">
        Pinned
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && <p className="font-mono text-xs text-dust">Loading —</p>}
        {isError && <p className="font-mono text-xs text-alert">Notes unavailable.</p>}
        {!isLoading && !isError && data?.length === 0 && (
          <p className="font-mono text-xs text-dust">— No pinned notes —</p>
        )}
        {!isLoading &&
          !isError &&
          data?.map((note) => (
            <a
              key={note.id}
              href={`/notes/n/${note.id}`}
              target="_top"
              className="block border-b border-dust py-1.5 font-display text-sm text-ink first:pt-0 last:border-b-0 hover:text-accent"
            >
              {note.title}
            </a>
          ))}
      </div>
    </div>
  );
}
