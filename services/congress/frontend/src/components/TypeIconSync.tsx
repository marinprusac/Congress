import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { setExhibitTypeIcons } from "@congress/congress-ui";
import { fetchTypes, TYPES_KEY } from "@/lib/recordsApi";

// Feeds each type's icon to the exhibit chips and pickers, which only know a type's slug.
export function TypeIconSync() {
  const { data } = useQuery({ queryKey: TYPES_KEY, queryFn: fetchTypes });
  useEffect(() => {
    if (data) setExhibitTypeIcons(new Map(data.map((t) => [t.definition.slug, t.definition.icon])));
  }, [data]);
  return null;
}
