import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PinnedView } from "@congress/shared-types";
import { ChamberMark, capitolSettingsQueryKey, fetchRegistry, updateCapitolSettings, useCapitolSettings } from "@congress/congress-ui";

const same = (a: PinnedView, b: PinnedView) => a.chamber === b.chamber && a.viewId === b.viewId;

// Settings -> Home: which views sit in the home screen's pinned row, and in
// what order. Everything else on Home is ranked automatically.
export function HomeSettingsTab() {
  const queryClient = useQueryClient();
  const { data: settings } = useCapitolSettings();
  const { data: registry } = useQuery({ queryKey: ["congress", "registry"], queryFn: fetchRegistry });
  const pinned = settings?.pinnedViews ?? [];

  const mutation = useMutation({
    mutationFn: (pinnedViews: PinnedView[]) => updateCapitolSettings({ pinnedViews }),
    onSuccess: (updated) => queryClient.setQueryData(capitolSettingsQueryKey(), updated),
  });

  const all = (registry ?? []).flatMap((c) => (c.views ?? []).map((v) => ({ chamber: c, view: v, key: { chamber: c.name, viewId: v.id } })));
  const labelFor = (p: PinnedView) => all.find((a) => same(a.key, p));

  function move(index: number, delta: number) {
    const next = [...pinned];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(index + delta, 0, item);
    mutation.mutate(next);
  }

  return (
    <section>
      <h3 className="mb-2 font-mono text-xs uppercase tracking-widest text-dust">Pinned</h3>
      {pinned.length === 0 && <p className="mb-4 font-mono text-sm text-dust">— Nothing pinned yet —</p>}
      <ul className="mb-6">
        {pinned.map((p, index) => {
          const found = labelFor(p);
          return (
            <li key={`${p.chamber}:${p.viewId}`} className="flex items-center gap-3 border-b border-dust py-2">
              <ChamberMark name={p.chamber} className="h-4 w-4 shrink-0 text-slate" />
              <span className="min-w-0 flex-1 truncate text-ink">{found ? found.view.label : `${p.chamber} / ${p.viewId} (unavailable)`}</span>
              <button type="button" className="tap-target font-mono text-xs text-dust hover:text-ink disabled:opacity-30" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Move up">
                ↑
              </button>
              <button
                type="button"
                className="tap-target font-mono text-xs text-dust hover:text-ink disabled:opacity-30"
                disabled={index === pinned.length - 1}
                onClick={() => move(index, 1)}
                aria-label="Move down"
              >
                ↓
              </button>
              <button type="button" className="tap-target font-mono text-xs text-alert" onClick={() => mutation.mutate(pinned.filter((x) => !same(x, p)))}>
                Unpin
              </button>
            </li>
          );
        })}
      </ul>

      <h3 className="mb-2 font-mono text-xs uppercase tracking-widest text-dust">Views</h3>
      <ul>
        {all
          .filter((a) => !pinned.some((p) => same(p, a.key)))
          .map(({ chamber, view, key }) => (
            <li key={`${key.chamber}:${key.viewId}`} className="flex items-center gap-3 border-b border-dust py-2">
              <ChamberMark name={chamber.name} className="h-4 w-4 shrink-0 text-slate" />
              <span className="min-w-0 flex-1 truncate text-ink">{view.label}</span>
              <span className="font-mono text-xs text-dust">{chamber.displayName}</span>
              <button type="button" className="tap-target font-mono text-xs text-accent" onClick={() => mutation.mutate([...pinned, key])}>
                Pin
              </button>
            </li>
          ))}
      </ul>
      {mutation.isError && <p className="mt-4 font-mono text-sm text-alert">{(mutation.error as Error).message}</p>}
    </section>
  );
}
