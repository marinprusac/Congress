import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchDocuments, fetchDocument } from "@/lib/api";

function formatTimestamp(value: string): string {
  return new Date(value).toISOString().replace("T", " ").slice(0, 16);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentsListPage() {
  const [query, setQuery] = useState("");
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["documents"],
    queryFn: fetchDocuments,
  });

  function prefetchDocument(id: number) {
    queryClient.prefetchQuery({ queryKey: ["document", id], queryFn: () => fetchDocument(id) });
  }

  const documents = data?.filter((doc) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return doc.title.toLowerCase().includes(q) || doc.filename.toLowerCase().includes(q);
  });

  return (
    <section>
      <input
        type="search"
        placeholder="Search documents —"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-6 w-full border border-dust bg-parchment px-3 py-2 font-mono text-base text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
      />

      <div className="border-t border-dust">
        {isLoading && <div className="px-1 py-3 font-mono text-sm text-dust">Loading —</div>}
        {isError && (
          <div className="px-1 py-3 font-mono text-sm text-alert">Failed to reach the Documents API.</div>
        )}
        {!isLoading && !isError && documents?.length === 0 && (
          <div className="border-b border-dust px-1 py-3 font-mono text-sm text-dust">
            — No documents {query ? "match your search" : "yet"} —
          </div>
        )}
        {!isLoading &&
          !isError &&
          documents?.map((doc) => (
            <Link
              key={doc.id}
              to={`/d/${doc.id}`}
              onMouseEnter={() => prefetchDocument(doc.id)}
              onFocus={() => prefetchDocument(doc.id)}
              className="block border-b border-dust px-1 py-3 hover:bg-ink/[0.03]"
            >
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-display text-lg text-ink">{doc.title}</span>
                <span className="shrink-0 font-mono text-xs text-dust">{formatTimestamp(doc.updatedAt)}</span>
              </div>
              <p className="mt-1 font-mono text-xs text-slate">
                {doc.filename} — {formatBytes(doc.sizeBytes)}
              </p>
            </Link>
          ))}
      </div>
    </section>
  );
}
