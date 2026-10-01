import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FieldDefinition, TypeOverview } from "@congress/shared-types";
import { fetchTypeOverviews, fetchTypeVersions } from "@/lib/recordsApi";

// Read-only: types change only through the AI's builder mode.

const originLabel = (t: TypeOverview) => (t.origin === "custom" ? "Custom" : t.forked ? "Premade, customized" : "Premade");

const actorLabel = (actor: string) => (actor === "premade" ? "Congress" : actor === "ai-builder" ? "AI (approved)" : actor);

function describeField(f: FieldDefinition): string {
  const bits: string[] = [f.options.target ? `${f.options.many ? "many " : ""}${f.options.target}` : f.kind];
  for (const key of ["required", "unique", "readonly", "hidden"] as const) if (f.options[key]) bits.push(key);
  return bits.join(" · ");
}

function Versions({ slug }: { slug: string }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ["types", slug, "versions"], queryFn: () => fetchTypeVersions(slug) });
  if (isLoading) return <p className="font-mono text-xs text-dust">Loading —</p>;
  if (isError || !data) return <p className="font-mono text-xs text-alert">Failed to load versions.</p>;
  return (
    <ol>
      {data.map((v) => (
        <li key={v.version} className="border-t border-dust/50 py-2">
          <p className="font-mono text-xs text-dust">
            v{v.version} · {actorLabel(v.actor)} ·{" "}
            {new Date(v.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          </p>
          <ul className="mt-1 space-y-0.5">
            {v.changes.map((c, i) => (
              <li key={i} className="break-words text-sm text-ink">
                {c.text}
              </li>
            ))}
            {!v.changes.length && <li className="text-sm text-dust">No visible change</li>}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function TypeRow({ type }: { type: TypeOverview }) {
  const [open, setOpen] = useState(false);
  const def = type.definition;
  const active = def.fields.filter((f) => !f.retired);
  const retired = def.fields.length - active.length;

  return (
    <li className="border-t border-dust py-3">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-baseline justify-between gap-3 text-left">
        <span className="min-w-0">
          <span className="font-display text-lg text-ink">{def.pluralLabel}</span>
          {def.hidden && <span className="ml-2 font-mono text-xs uppercase text-dust">Hidden</span>}
          <span className="block font-mono text-xs text-dust">
            {originLabel(type)} · v{type.version} · {type.recordCount} {type.recordCount === 1 ? "record" : "records"}
          </span>
        </span>
        <span className="shrink-0 font-mono text-xs uppercase text-accent">{open ? "Close" : "Details"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          <div>
            <h4 className="mb-1 font-mono text-xs uppercase tracking-wide text-dust">Fields</h4>
            <ul>
              {active.map((f) => (
                <li key={f.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-0.5 text-sm">
                  <span className="text-ink">
                    {f.label}
                    {def.titleField === f.id && <span className="ml-1 font-mono text-xs text-dust">(title)</span>}
                  </span>
                  <span className="font-mono text-xs text-dust">{describeField(f)}</span>
                </li>
              ))}
            </ul>
            {retired > 0 && <p className="mt-1 font-mono text-xs text-dust">{retired} retired, data kept</p>}
          </div>
          <div>
            <h4 className="mb-1 font-mono text-xs uppercase tracking-wide text-dust">History</h4>
            <Versions slug={def.slug} />
          </div>
        </div>
      )}
    </li>
  );
}

export function TypesSettingsTab() {
  const { data, isLoading, isError } = useQuery({ queryKey: ["types", "overview"], queryFn: fetchTypeOverviews });
  const sorted = [...(data ?? [])].sort((a, b) => a.definition.label.localeCompare(b.definition.label));

  return (
    <div>
      <h3 className="font-display text-xl text-ink">Exhibit types</h3>
      <p className="mb-3 font-mono text-xs text-dust">
        To add or change a type, ask the AI in a chat. It asks for builder mode first, and every change needs your approval.
      </p>
      {isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
      {isError && <p className="font-mono text-sm text-alert">Failed to load types.</p>}
      <ul>
        {sorted.map((t) => (
          <TypeRow key={t.id} type={t} />
        ))}
      </ul>
    </div>
  );
}
