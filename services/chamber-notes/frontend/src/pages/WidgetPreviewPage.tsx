import { useQuery } from "@tanstack/react-query";
import { fetchWidget } from "@/lib/api";

export function WidgetPreviewPage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ["widget"], queryFn: fetchWidget });

  return (
    <section>
      <h2 className="mb-6 border-b border-dust pb-4 font-display text-3xl text-ink">
        Widget Preview
      </h2>
      <p className="mb-4 font-mono text-xs text-dust">
        This is what Capitol's homepage composes for this Chamber via GET /api/notes/widget.
      </p>
      <div className="border border-dust p-4">
        {isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
        {isError && <p className="font-mono text-sm text-alert">Widget unavailable.</p>}
        {data && (
          <>
            <p className="font-mono text-sm text-ink">{data.summary}</p>
            <ul className="mt-2">
              {data.items.map((item, i) => (
                <li key={i} className="border-t border-dust py-1.5 first:border-t-0">
                  <span className="font-mono text-sm text-slate">{item.label}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
