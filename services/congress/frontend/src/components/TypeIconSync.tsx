import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { setExhibitTypeColors, setExhibitTypeIcons } from "@congress/congress-ui";
import { fetchTypes, TYPES_KEY } from "@/lib/recordsApi";

// Feeds each type's icon and colour to the exhibit chips and pickers, which only know a type's slug.
export function TypeIconSync() {
  const { data } = useQuery({ queryKey: TYPES_KEY, queryFn: fetchTypes });
  useEffect(() => {
    if (!data) return;
    setExhibitTypeIcons(new Map(data.map((t) => [t.definition.slug, t.definition.icon])));
    setExhibitTypeColors(new Map(data.map((t) => [t.definition.slug, t.definition.color])));
  }, [data]);
  return null;
}
