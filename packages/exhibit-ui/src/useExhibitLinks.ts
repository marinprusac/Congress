import { useQuery } from "@tanstack/react-query";
import type { CapitolExhibitResolveResult } from "@congress/shared-types";

async function fetchExhibitLinks(
  exhibitId: string,
  kind: "backlinks" | "frontlinks"
): Promise<CapitolExhibitResolveResult[]> {
  const res = await fetch(`/capitol/exhibits/${encodeURIComponent(exhibitId)}/${kind}`);
  if (!res.ok) return [];
  const data = (await res.json()) as Record<"backlinks" | "frontlinks", CapitolExhibitResolveResult[]>;
  return data[kind];
}

export function useExhibitLinks(exhibitId: string): {
  backlinks: CapitolExhibitResolveResult[];
  frontlinks: CapitolExhibitResolveResult[];
} {
  const backlinksQuery = useQuery({
    queryKey: ["exhibit-backlinks", exhibitId],
    queryFn: () => fetchExhibitLinks(exhibitId, "backlinks"),
  });
  const frontlinksQuery = useQuery({
    queryKey: ["exhibit-frontlinks", exhibitId],
    queryFn: () => fetchExhibitLinks(exhibitId, "frontlinks"),
  });

  return {
    backlinks: backlinksQuery.data ?? [],
    frontlinks: frontlinksQuery.data ?? [],
  };
}
