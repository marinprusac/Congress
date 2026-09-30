import { useQuery } from "@tanstack/react-query";
import type { ManifestView } from "@congress/shared-types";
import { fetchRegistry } from "@congress/congress-ui";
import { fetchTypes, TYPES_KEY } from "@/lib/recordsApi";

// Every view the owner can open or pin: active Chambers' manifest views, plus
// Congress's own hand-written ones (shown once their type is in use).

export interface ViewSource {
  name: string;
  displayName: string;
  views: ManifestView[];
}

const CORE_VIEWS: (ViewSource & { type: string })[] = [
  {
    name: "events",
    displayName: "Calendar",
    type: "event",
    views: [
      { id: "timeline", label: "Timeline", fullPath: "/" },
      { id: "week", label: "Week", fullPath: "/week" },
    ],
  },
];

export function useViewSources(): ViewSource[] {
  const { data: registry } = useQuery({ queryKey: ["congress", "registry"], queryFn: fetchRegistry });
  const { data: types } = useQuery({ queryKey: TYPES_KEY, queryFn: fetchTypes });
  const inUse = new Set((types ?? []).filter((t) => !t.definition.hidden).map((t) => t.definition.slug));
  const chambers = (registry ?? []).filter((c) => c.status === "active").map((c) => ({ name: c.name, displayName: c.displayName, views: c.views ?? [] }));
  return [...CORE_VIEWS.filter((v) => inUse.has(v.type)), ...chambers];
}

export function findView(sources: ViewSource[], name: string, viewId: string): { source: ViewSource; view: ManifestView } | null {
  const source = sources.find((s) => s.name === name);
  const view = source?.views.find((v) => v.id === viewId);
  return source && view ? { source, view } : null;
}
