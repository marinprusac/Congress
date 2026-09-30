import { useRef, useState } from "react";
import type { CapitolExhibitResolveResult, FieldDefinition, FileRef, RecordValue } from "@congress/shared-types";
import {
  ExhibitChip,
  ExhibitFieldEditor,
  FormLabel,
  getChamberIcon,
  showToast,
  useExhibitSearch,
  useResolvedExhibits,
} from "@congress/congress-ui";
import { fileUrl, uploadFile } from "@/lib/recordsApi";
import { fromLocalInput, toLocalInput } from "./datetime";
import { formatBytes } from "./format";

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
    case "date":
      return (
        <input
          type="date"
          className="field-plain w-full font-mono text-base"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case "relation":
      return <RelationControl field={field} value={value} onChange={onChange} onNavigate={onNavigate} />;
    case "file":
      return <FileControl field={field} value={value} onChange={onChange} onNavigate={onNavigate} />;
  }
}

export function isFileRef(value: RecordValue | undefined): value is FileRef {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "mime" in value;
}

function FileControl({ value, onChange }: FieldProps) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const file = isFileRef(value) ? value : null;

  const pick = async (picked: File | undefined) => {
    if (!picked) return;
    setBusy(true);
    try {
      onChange(await uploadFile(picked));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Upload failed.", "error");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const input = <input ref={inputRef} type="file" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />;
  if (!file) {
    return (
      <div>
        {input}
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="tap-target font-mono text-sm text-accent hover:underline disabled:text-dust">
          {busy ? "Uploading —" : "Choose file"}
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {input}
      {file.mime.startsWith("image/") && <img src={fileUrl(file.id)} alt={file.name} className="max-h-72 max-w-full rounded border border-dust object-contain" />}
      <p className="break-all font-mono text-sm text-ink">
        {file.name} <span className="text-dust">· {formatBytes(file.size)}</span>
      </p>
      <div className="flex flex-wrap gap-x-4">
        <a href={fileUrl(file.id)} target="_blank" rel="noopener" className="tap-target font-mono text-sm text-accent hover:underline">
          Open
        </a>
        <a href={fileUrl(file.id, true)} download={file.name} className="tap-target font-mono text-sm text-accent hover:underline">
          Download
        </a>
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="tap-target font-mono text-sm text-slate hover:underline disabled:text-dust">
          {busy ? "Uploading —" : "Replace"}
        </button>
      </div>
    </div>
  );
}

// Engine-written values: shown, never edited.
export function ReadonlyValue({ field, value }: { field: FieldDefinition; value: RecordValue | undefined }) {
  const text =
    value === null || value === undefined || value === ""
      ? "—"
      : field.kind === "datetime" && typeof value === "string"
        ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
        : field.kind === "boolean"
          ? value
            ? "Yes"
            : "No"
          : String(value);
  return <p className="font-mono text-base text-slate">{text}</p>;
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
