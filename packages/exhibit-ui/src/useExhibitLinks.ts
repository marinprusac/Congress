import { useQuery } from "@tanstack/react-query";
import type { ExhibitRefEntry } from "@congress/shared-types";

async function fetchExhibitLinks(
  exhibitId: string,
  kind: "backlinks" | "frontlinks"
): Promise<ExhibitRefEntry[]> {
  const res = await fetch(`/capitol/exhibits/${encodeURIComponent(exhibitId)}/${kind}`);
  if (!res.ok) return [];
  const data = (await res.json()) as Record<"backlinks" | "frontlinks", ExhibitRefEntry[]>;
  return data[kind];
}

export function useExhibitLinks(exhibitId: string): {
  backlinks: ExhibitRefEntry[];
  frontlinks: ExhibitRefEntry[];
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
