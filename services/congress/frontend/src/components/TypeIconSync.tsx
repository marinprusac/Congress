import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { setRecordTypeColors, setRecordTypeIcons } from "@congress/congress-ui";
import { fetchTypes, TYPES_KEY } from "@/lib/recordsApi";

// Feeds each type's icon and colour to the record chips and pickers, which only know a type's slug.
export function TypeIconSync() {
  const { data } = useQuery({ queryKey: TYPES_KEY, queryFn: fetchTypes });
  useEffect(() => {
    if (!data) return;
    setRecordTypeIcons(new Map(data.map((t) => [t.definition.slug, t.definition.icon])));
    setRecordTypeColors(new Map(data.map((t) => [t.definition.slug, t.definition.color])));
  }, [data]);
  return null;
}
