import type { CapitolRecordResolveResult, RelatedGroup } from "@congress/shared-types";
import { RecordChip, FormLabel, getRecordIcon } from "@congress/congress-ui";

// Reverse relations: records elsewhere whose relation field links here.
export function RelatedSection({
  groups,
  onNavigate,
}: {
  groups: RelatedGroup[];
  onNavigate: (result: Extract<CapitolRecordResolveResult, { url: string }>) => void;
}) {
  return (
    <section className="mb-6 grid grid-cols-1 gap-4" aria-label="Linked from">
      {groups.map((g) => (
        <div key={`${g.type}:${g.field}`} className="min-w-0">
          <FormLabel>
            {g.typeLabel} · {g.fieldLabel} ({g.total})
          </FormLabel>
          <div className="flex flex-wrap gap-2">
            {g.records.map((r) => (
              <RecordChip key={r.id} result={{ ...r, chamber: "e" }} renderIcon={getRecordIcon} onNavigate={onNavigate} />
            ))}
            {g.total > g.records.length && <span className="self-center font-mono text-xs text-dust">and {g.total - g.records.length} more</span>}
          </div>
        </div>
      ))}
    </section>
  );
}
