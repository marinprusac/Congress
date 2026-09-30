import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChamberHeader,
  ChamberMark,
  ConfirmSheet,
  ExhibitActionBar,
  ExhibitFieldEditor,
  ExhibitLinksLayout,
  flushDraftConnections,
  getChamberIcon,
  navigateToExhibit,
  resolveEditorIdentity,
  showToast,
  useAppliedTheme,
  useAutosave,
  useBackNavigation,
  useDraftCreate,
  useSelfNavigateGuard,
  useStackNav,
} from "@congress/congress-ui";
import type { CapitolExhibitResolveResult, CapitolExhibitSearchResult, FieldDefinition, RecordValue, TypeDefinition } from "@congress/shared-types";
import { createRecord, deleteRecord, fetchRecord, fetchTypes, quickCreateRecord, RecordConflict, updateRecord } from "@/lib/recordsApi";
import { FieldControl, isFileRef, PropertyRow, ReadonlyValue } from "./fields";
import { titleFromFilename } from "./format";

// One page for every runtime exhibit type: /e/:id and /e/new/:type. A new
// record is created on the title's blur, then autosaves a diff of changed
// fields, the same flow Notes' editor used.

export const TYPES_KEY = ["congress", "types"] as const;
type Values = Record<string, RecordValue>;

function defaultFor(f: FieldDefinition): RecordValue {
  if (f.kind === "text" || f.kind === "richtext") return "";
  if (f.kind === "boolean") return false;
  if (f.kind === "relation" && f.options.many) return [];
  return null;
}

// Editable fields in order, so autosave's content comparison is stable.
// Readonly fields are engine-written and shown from the server's copy.
function canonical(def: TypeDefinition | undefined, values: Values): Values {
  if (!def) return {};
  return Object.fromEntries(def.fields.filter((f) => !f.retired && !f.options.readonly).map((f) => [f.slug, values[f.slug] ?? defaultFor(f)]));
}

// What the API takes: a file field's id rather than its expanded value.
function toInput(values: Values): Values {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, isFileRef(v) ? v.id : v]));
}

function isFilled(f: FieldDefinition, v: RecordValue | undefined): boolean {
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return v !== null && v !== undefined;
}

function diff(prev: Values, next: Values): Values {
  return Object.fromEntries(Object.entries(next).filter(([k, v]) => JSON.stringify(prev[k]) !== JSON.stringify(v)));
}

export function RecordPage() {
  useAppliedTheme();
  const { id: idParam, type: typeParam } = useParams<{ id?: string; type?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const nav = useStackNav();
  const back = useBackNavigation();
  const queryClient = useQueryClient();
  const { markSelfNavigate, consumeSelfNavigate } = useSelfNavigateGuard();

  const [recordId, setRecordId] = useState<string | null>(idParam ?? null);
  const [values, setValues] = useState<Values>({});
  const [draftConnections, setDraftConnections] = useState<CapitolExhibitSearchResult[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Stops the query and autosave from touching a record that's gone.
  const [deleted, setDeleted] = useState(false);
  const savedRef = useRef<Values>({});
  const initializedRef = useRef<string | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);

  const typesQuery = useQuery({ queryKey: TYPES_KEY, queryFn: fetchTypes });
  const recordQuery = useQuery({ queryKey: ["record", recordId], queryFn: () => fetchRecord(recordId as string), enabled: recordId !== null && !deleted });

  const typeSlug = recordQuery.data?.type ?? typeParam;
  const type = typesQuery.data?.find((t) => t.definition.slug === typeSlug);
  const def = type?.definition;
  const titleField = def?.fields.find((f) => f.id === def.titleField);
  const bodyField = def?.layout.body ? def.fields.find((f) => f.id === def.layout.body && !f.retired) : undefined;
  const actionFields = new Set(def?.actions.map((a) => a.field) ?? []);
  const properties = def?.fields.filter((f) => !f.retired && f !== titleField && f !== bodyField && !actionFields.has(f.id)) ?? [];
  const requiredFields = def?.fields.filter((f) => !f.retired && !f.options.readonly && f.options.required) ?? [];
  // Set when a draft gains a value off-blur (an upload), to try creating after render.
  const attemptPendingRef = useRef(false);
  const current = useMemo(() => canonical(def, values), [def, values]);
  const isDraft = recordId === null;

  // Seeds a new record's title from ?title= (the "@" picker's create flow).
  useEffect(() => {
    const seeded = searchParams.get("title");
    if (isDraft && seeded && titleField) setValues((v) => ({ ...v, [titleField.slug]: seeded }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titleField?.slug]);

  const onNavigate = (r: Extract<CapitolExhibitResolveResult, { url: string }>) => navigateToExhibit("e", r, navigate, true);

  const createMutation = useMutation({
    mutationFn: async (draft: Values) => {
      const created = await createRecord(typeSlug as string, toInput(draft));
      await flushDraftConnections(created.id, draftConnections);
      return created;
    },
    onSuccess: (created) => {
      queryClient.setQueryData(["record", created.id], created);
      if (recordId !== null) return;
      const saved = canonical(def, created.values);
      savedRef.current = saved;
      initializedRef.current = created.id;
      markSaved(canonical(def, { ...created.values, ...values }));
      setValues((v) => ({ ...created.values, ...v }));
      setRecordId(created.id);
      markSelfNavigate();
      navigate(`/e/${created.id}`, { replace: true });
    },
    onError: (err) => {
      draftCreate.reset();
      showToast(err instanceof RecordConflict ? err.message : `Failed to create ${def?.label.toLowerCase() ?? "record"}.`, "error");
    },
  });

  const draftCreate = useDraftCreate({
    value: current,
    canCreate: (v) =>
      recordId === null && Boolean(titleField && String(v[titleField.slug] ?? "").trim()) && requiredFields.every((f) => isFilled(f, v[f.slug])),
    onCreate: (draft) => createMutation.mutate(draft),
  });

  // Same component across /e/a -> /e/b and back to a new draft.
  useEffect(() => {
    if (consumeSelfNavigate()) return;
    const fromUrl = idParam ?? null;
    if (resolveEditorIdentity(fromUrl, recordId) === "keep") return;
    draftCreate.attempt();
    setRecordId(fromUrl);
    setValues({});
    setDraftConnections([]);
    initializedRef.current = null;
    savedRef.current = {};
    draftCreate.reset();
    if (fromUrl === null) titleRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idParam, recordId]);

  const updateMutation = useMutation({
    mutationFn: (patch: Values) => updateRecord(recordId as string, toInput(patch)),
    onSuccess: (updated) => queryClient.setQueryData(["record", updated.id], updated),
    onError: (err) => showToast(err instanceof RecordConflict ? err.message : "Couldn't save.", "error"),
  });

  const { markSaved } = useAutosave({
    value: current,
    enabled: recordId !== null && !deleted && initializedRef.current === recordId,
    onSave: (next) => {
      const patch = diff(savedRef.current, next);
      if (Object.keys(patch).length === 0) return;
      savedRef.current = { ...savedRef.current, ...patch };
      updateMutation.mutate(patch);
    },
  });

  // Loads server values once per record; refetches never stomp edits.
  useEffect(() => {
    const data = recordQuery.data;
    if (!data || !def || initializedRef.current === data.id) return;
    const loaded = canonical(def, data.values);
    setValues(loaded);
    savedRef.current = loaded;
    markSaved(loaded);
    initializedRef.current = data.id;
  }, [recordQuery.data, def, markSaved]);

  const deleteMutation = useMutation({
    mutationFn: () => deleteRecord(recordId as string),
    onSuccess: () => {
      setDeleted(true);
      queryClient.removeQueries({ queryKey: ["record", recordId] });
      nav.pop();
      showToast(`${def?.label ?? "Record"} deleted`);
    },
    onError: () => showToast("Failed to delete.", "error"),
  });

  const toggle = (field: string) => {
    const f = def?.fields.find((x) => x.id === field);
    if (!f) return;
    setValues((v) => ({ ...v, [f.slug]: !(current[f.slug] === true) }));
  };

  const set = (slug: string, value: RecordValue) =>
    setValues((v) => {
      const next = { ...v, [slug]: value };
      // A first upload names an untitled record after its file.
      if (isFileRef(value) && titleField && !String(v[titleField.slug] ?? "").trim()) next[titleField.slug] = titleFromFilename(value.name);
      return next;
    });

  const setFile = (slug: string, value: RecordValue) => {
    set(slug, value);
    attemptPendingRef.current = true;
  };

  useEffect(() => {
    if (!attemptPendingRef.current) return;
    attemptPendingRef.current = false;
    draftCreate.attempt();
  }, [current, draftCreate]);

  const header = (
    <ChamberHeader
      icon={<ChamberMark name="e" className="h-6 w-6 text-ink" />}
      title={def?.label ?? "Record"}
      titleHref=""
      onBack={back}
    />
  );

  const loading = typesQuery.isLoading || (!isDraft && recordQuery.isLoading);
  const missing = !loading && (!def || (!isDraft && (recordQuery.isError || !recordQuery.data)));

  return (
    <div className="chamber-shell">
      {header}
      <main className="chamber-main">
        {loading && <p className="font-mono text-sm text-dust">Loading —</p>}
        {missing && <p className="font-mono text-sm text-alert">Not found.</p>}
        {!loading && !missing && def && (
          <article>
            {titleField && (
              <div className="mb-6 border-b border-dust pb-4">
                <input
                  ref={titleRef}
                  autoFocus={isDraft}
                  value={String(current[titleField.slug] ?? "")}
                  onChange={(e) => set(titleField.slug, e.target.value)}
                  onBlur={() => draftCreate.attempt()}
                  placeholder={isDraft ? titleField.label : "Untitled"}
                  className="w-full font-display text-3xl text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
                />
              </div>
            )}

            {properties.length > 0 && (
              <div className="mb-6 grid grid-cols-1 gap-4">
                {properties
                  .filter((f) => !(f.options.readonly && isDraft))
                  .map((f) => (
                    <PropertyRow key={f.id} field={f}>
                      {f.options.readonly ? (
                        <ReadonlyValue field={f} value={recordQuery.data?.values[f.slug]} />
                      ) : (
                        <FieldControl
                          field={f}
                          value={current[f.slug] ?? null}
                          onChange={(v) => (f.kind === "file" ? setFile(f.slug, v) : set(f.slug, v))}
                          onNavigate={onNavigate}
                        />
                      )}
                    </PropertyRow>
                  ))}
              </div>
            )}

            <ExhibitLinksLayout
              exhibitId={recordId}
              renderIcon={(chamber) => getChamberIcon(chamber)}
              onNavigate={onNavigate}
              editable
              onCreateReference={type ? (title) => quickCreateRecord(type, title) : undefined}
              draftConnections={draftConnections}
              onDraftConnectionsChange={setDraftConnections}
              actions={
                <ExhibitActionBar>
                  {isDraft ? (
                    <button onClick={() => nav.pop()} className="tap-target text-slate hover:underline">
                      Cancel
                    </button>
                  ) : (
                    <>
                      {def.actions.map((a) => {
                        const f = def.fields.find((x) => x.id === a.field);
                        return (
                          <button key={a.field} onClick={() => toggle(a.field)} className="tap-target text-accent hover:underline">
                            {f && current[f.slug] === true ? a.on : a.off}
                          </button>
                        );
                      })}
                      <button onClick={() => setConfirmingDelete(true)} className="tap-target text-alert hover:underline">
                        Delete
                      </button>
                    </>
                  )}
                </ExhibitActionBar>
              }
            >
              {bodyField ? (
                <ExhibitFieldEditor
                  value={String(current[bodyField.slug] ?? "")}
                  onChange={(v) => set(bodyField.slug, v)}
                  minRows={3}
                  placeholder="Start writing. Type @ to reference a note, event, or other Exhibit."
                  className="w-full bg-parchment p-3 font-body text-base text-ink focus-within:outline-none"
                  renderIcon={(chamber) => getChamberIcon(chamber)}
                  onNavigate={onNavigate}
                  onCreate={type ? (title) => quickCreateRecord(type, title) : undefined}
                />
              ) : (
                <span />
              )}
            </ExhibitLinksLayout>

            {!isDraft && (
              <ConfirmSheet
                open={confirmingDelete}
                title={`Delete ${def.label.toLowerCase()}`}
                message={`Delete "${titleField ? String(current[titleField.slug] ?? "") : def.label}"? This cannot be undone.`}
                confirmLabel="Delete"
                onConfirm={() => {
                  setConfirmingDelete(false);
                  deleteMutation.mutate();
                }}
                onCancel={() => setConfirmingDelete(false)}
              />
            )}
          </article>
        )}
      </main>
    </div>
  );
}
