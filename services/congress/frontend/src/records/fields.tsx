import { useState } from "react";
import type { CapitolExhibitResolveResult, FieldDefinition, RecordValue } from "@congress/shared-types";
import {
  ExhibitChip,
  ExhibitFieldEditor,
  FormLabel,
  getChamberIcon,
  useExhibitSearch,
  useResolvedExhibits,
} from "@congress/congress-ui";
import { fromLocalInput, toLocalInput } from "./datetime";

// One control per field kind; every record page is built from these.

export interface FieldProps {
  field: FieldDefinition;
  value: RecordValue;
  onChange: (value: RecordValue) => void;
  onNavigate: (result: Extract<CapitolExhibitResolveResult, { url: string }>) => void;
}

export function FieldControl({ field, value, onChange, onNavigate }: FieldProps) {
  switch (field.kind) {
    case "text":
      return <input className="field-plain w-full font-mono text-base" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "richtext":
      return (
        <ExhibitFieldEditor
          value={String(value ?? "")}
          onChange={onChange}
          minRows={1}
          className="w-full bg-parchment p-2 font-body text-base text-ink focus-within:outline-none"
          renderIcon={(chamber) => getChamberIcon(chamber)}
          onNavigate={onNavigate}
        />
      );
    case "boolean":
      return <input type="checkbox" className="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
    case "datetime":
      return (
        <input
          type="datetime-local"
          className="field-plain w-full font-mono text-base"
          value={toLocalInput(typeof value === "string" ? value : null)}
          onChange={(e) => onChange(fromLocalInput(e.target.value))}
        />
      );
    case "number":
      return (
        <input
          type="number"
          inputMode="decimal"
          className="field-plain w-full font-mono text-base"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
      );
    case "enum":
      return (
        <select className="field-plain w-full font-mono text-base" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {(field.options.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "relation":
      return <RelationControl field={field} value={value} onChange={onChange} onNavigate={onNavigate} />;
  }
}

function RelationControl({ field, value, onChange, onNavigate }: FieldProps) {
  const ids = Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
  const { resultsByToken } = useResolvedExhibits(ids.map((id) => `exhibit:e:${id}`));
  const [query, setQuery] = useState("");
  const { results } = useExhibitSearch(query, query.trim().length > 0);
  const matches = results.filter((r) => r.chamber === "e" && r.type === field.options.target && !ids.includes(r.id)).slice(0, 5);

  const set = (next: string[]) => onChange(field.options.many ? next : (next[0] ?? null));

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        {ids.map((id) => {
          const hit = resultsByToken.get(`exhibit:e:${id}`);
          return (
            <span key={id} className="inline-flex items-center gap-1">
              {hit ? <ExhibitChip result={hit} renderIcon={(c) => getChamberIcon(c)} onNavigate={onNavigate} /> : <span className="font-mono text-xs text-dust">…</span>}
              <button type="button" aria-label="Remove" className="font-mono text-xs text-dust" onClick={() => set(ids.filter((x) => x !== id))}>
                ×
              </button>
            </span>
          );
        })}
      </div>
      {(field.options.many || ids.length === 0) && (
        <input className="field-plain w-full font-mono text-sm" placeholder={`Link a ${field.options.target ?? "record"}…`} value={query} onChange={(e) => setQuery(e.target.value)} />
      )}
      {matches.map((m) => (
        <button
          key={m.id}
          type="button"
          className="block font-mono text-sm text-accent hover:underline"
          onClick={() => {
            set([...ids, m.id]);
            setQuery("");
          }}
        >
          {m.name}
        </button>
      ))}
    </div>
  );
}

export function PropertyRow({ field, children }: { field: FieldDefinition; children: React.ReactNode }) {
  return (
    <div className={field.kind === "boolean" ? "flex items-center justify-between gap-4" : "min-w-0"}>
      <FormLabel>{field.label}</FormLabel>
      {children}
    </div>
  );
}
