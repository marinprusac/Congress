import { Link } from "react-router-dom";
import { useState } from "react";
import {
  useShellHosted,
  resolveChamberPath,
  useSearchableList,
  useListRowPrefetch,
  ListSearchInput,
  ListLoadingState,
  ListErrorState,
  ListEmptyState,
  formatTimestamp,
} from "@congress/congress-ui";
import { fetchDocuments, fetchDocument } from "@/lib/api";
import type { DocumentSummary } from "../../../src/types";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function matchesQuery(doc: DocumentSummary, q: string): boolean {
  return doc.title.toLowerCase().includes(q) || doc.filename.toLowerCase().includes(q);
}

export function DocumentsListPage() {
  const [query, setQuery] = useState("");
  const shellHosted = useShellHosted();

  const { data, isLoading, isError } = useSearchableList({
    queryKeyBase: "documents",
    query,
    fetchAll: fetchDocuments,
    filterClient: matchesQuery,
  });

  const prefetchDocument = useListRowPrefetch((id: number) => ["document", id], fetchDocument);

  const documents = data;

  return (
    <section className="list-page">
      <ListSearchInput value={query} onChange={setQuery} placeholder="Search documents —" />

      {isLoading && <ListLoadingState />}
      {isError && <ListErrorState label="Documents" />}
      {!isLoading && !isError && documents?.length === 0 && (
        <ListEmptyState label="documents" hasQuery={!!query} />
      )}
      {!isLoading &&
        !isError &&
        documents?.map((doc) => (
          <Link
            key={doc.id}
            to={resolveChamberPath(`/d/${doc.id}`, "documents", shellHosted)}
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
    </section>
  );
}
