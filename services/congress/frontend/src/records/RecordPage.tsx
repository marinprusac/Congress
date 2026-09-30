import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { LIVE_RENDERERS } from "@/connectors/live";
import {
  canCreate,
  createRecord,
  deleteRecord,
  fetchRecord,
  fetchRelated,
  fetchTargets,
  fetchTypes,
  quickCreateRecord,
  RecordConflict,
  runRecordAction,
  TYPES_KEY,
  updateRecord,
} from "@/lib/recordsApi";
export { TYPES_KEY };
import { DestinationControl, FieldControl, isFileRef, PropertyRow, ReadonlyValue } from "./fields";
import { BindingNotice, LiveValues } from "./BindingPanel";
import { TimeRangeControl, type RangeValue } from "./TimeRangeControl";
import { DEFAULT_MINUTES, plusMinutes } from "./timeRange";
import { RelatedSection } from "./RelatedSection";
import { titleFromFilename } from "./format";

// One page for every runtime exhibit type: /e/:id and /e/new/:type. A new
// record is created on the title's blur, then autosaves a diff of changed
// fields, the same flow Notes' editor used.


type Values = Record<string, RecordValue>;

// Any record's reverse relations; a save or delete can change them.
const isRelatedQuery = (q: { queryKey: readonly unknown[] }) => q.queryKey[0] === "record" && q.queryKey[2] === "related";

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

const isEmptyValue = (v: RecordValue | undefined) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

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
  const recordQuery = useQuery({
    queryKey: ["record", recordId],
    queryFn: () => fetchRecord(recordId as string),
    enabled: recordId !== null && !deleted,
    // Until a push reaches the source.
    refetchInterval: (q) => (q.state.data?.binding?.pending && !q.state.data.binding.pending.failed ? 3000 : false),
  });
  const relatedQuery = useQuery({ queryKey: ["record", recordId, "related"], queryFn: () => fetchRelated(recordId as string), enabled: recordId !== null && !deleted });

  const typeSlug = recordQuery.data?.type ?? typeParam;
  const type = typesQuery.data?.find((t) => t.definition.slug === typeSlug);
  const def = type?.definition;
  const titleField = def?.fields.find((f) => f.id === def.titleField);
  const bodyField = def?.layout.body ? def.fields.find((f) => f.id === def.layout.body && !f.retired) : undefined;
  const actionFields = new Set(def?.actions.map((a) => a.field) ?? []);
  const range = def?.layout.timeRange ?? null;
  const live = (id: string | null | undefined) => (id ? def?.fields.find((f) => f.id === id && !f.retired) : undefined);
  const [startField, endField, allDayField] = [live(range?.start), live(range?.end), live(range?.allDay)];
  const rangeIds = new Set([startField?.id, endField?.id, allDayField?.id].filter(Boolean));
  const properties =
    def?.fields.filter((f) => !f.retired && f !== titleField && f !== bodyField && !actionFields.has(f.id) && !rangeIds.has(f.id)) ?? [];
  const binding = recordQuery.data?.binding ?? null;
  const locked = new Set(binding?.locked ?? []);
  const createsAtSource = Boolean(def?.bindings.some((b) => b.create));
  const bound = binding ? def?.bindings.find((b) => b.id === binding.id) : undefined;
  const Live = binding?.detail && bound ? LIVE_RENDERERS[`${bound.connector}:${bound.kind}`] : undefined;
  const creatable = def ? canCreate(def) : false;
  const targetsQuery = useQuery({ queryKey: ["types", typeSlug, "targets"], queryFn: () => fetchTargets(typeSlug as string), enabled: createsAtSource && Boolean(typeSlug) });
  const destination = targetsQuery.data?.[0];
  const requiredFields = def?.fields.filter((f) => !f.retired && !f.options.readonly && f.options.required) ?? [];
  // Set when a draft gains a value off-blur (an upload), to try creating after render.
  const attemptPendingRef = useRef(false);
  const current = useMemo(() => canonical(def, values), [def, values]);
  const isDraft = recordId === null;
  const related = useMemo(() => relatedQuery.data ?? [], [relatedQuery.data]);
  const linkingCount = related.reduce((n, g) => n + g.total, 0);
  // Links shown as relation chips or under Related, left out of Connections.
  const shownLinks = useMemo(() => {
    const ids = new Set(related.flatMap((g) => g.records.map((r) => r.id)));
    for (const f of def?.fields ?? []) {
      if (f.kind !== "relation" || f.retired) continue;
      const v = current[f.slug];
      for (const id of Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []) ids.add(String(id));
    }
    return ids;
  }, [related, def, current]);

  // Seeds a new record's title from ?title= (the "@" picker's create flow),
  // and its time range from ?start= and ?duration= (minutes), else the next hour.
  useEffect(() => {
    const seeded = searchParams.get("title");
    if (isDraft && seeded && titleField) setValues((v) => ({ ...v, [titleField.slug]: seeded }));
    if (isDraft && startField && endField) {
      const given = Date.parse(searchParams.get("start") ?? "");
      const next = new Date();
      next.setMinutes(0, 0, 0);
      next.setHours(next.getHours() + 1);
      const start = new Date(Number.isFinite(given) ? given : next.getTime()).toISOString();
      const minutes = Number(searchParams.get("duration")) || DEFAULT_MINUTES;
      setValues((v) => ({ ...v, [startField.slug]: start, [endField.slug]: plusMinutes(start, minutes) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titleField?.slug, startField?.slug]);

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
    onSuccess: (updated) => {
      queryClient.setQueryData(["record", updated.id], updated);
      void queryClient.invalidateQueries({ predicate: isRelatedQuery });
    },
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
      void queryClient.invalidateQueries({ predicate: isRelatedQuery });
      nav.pop();
      showToast(`${def?.label ?? "Record"} deleted`);
    },
    onError: () => showToast("Failed to delete.", "error"),
  });

  const actionMutation = useMutation({
    mutationFn: (action: string) => runRecordAction(recordId as string, action),
    onSuccess: (updated) => queryClient.setQueryData(["record", updated.id], updated),
    onError: (err) => showToast(err instanceof Error ? err.message : "Couldn't do that.", "error"),
  });
  // Actions a live view runs on its own (e.g. mark read on open): no toast when they fail.
  const runSilently = useCallback(
    (action: string) => {
      if (!recordId) return;
      runRecordAction(recordId, action)
        .then((updated) => queryClient.setQueryData(["record", updated.id], updated))
        .catch(() => {});
    },
    [recordId, queryClient]
  );

  const setRange = (next: RangeValue) => {
    if (!startField || !endField) return;
    setValues((v) => ({ ...v, [startField.slug]: next.start, [endField.slug]: next.end, ...(allDayField ? { [allDayField.slug]: next.allDay } : {}) }));
  };

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
            {titleField && locked.has(titleField.slug) && (
              // Kept by the source: shown whole, wrapping, rather than as a one-line input.
              <div className="mb-6 border-b border-dust pb-4">
                <h1 className="break-words font-display text-3xl text-ink">{String(current[titleField.slug] ?? "") || "Untitled"}</h1>
              </div>
            )}
            {titleField && !locked.has(titleField.slug) && (
              <div className="mb-6 border-b border-dust pb-4">
                <input
                  ref={titleRef}
                  readOnly={locked.has(titleField.slug)}
                  autoFocus={isDraft}
                  value={String(current[titleField.slug] ?? "")}
                  onChange={(e) => set(titleField.slug, e.target.value)}
                  onBlur={() => draftCreate.attempt()}
                  placeholder={isDraft ? titleField.label : "Untitled"}
                  className="w-full font-display text-3xl text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
                />
              </div>
            )}

            {binding && <BindingNotice binding={binding} />}

            {startField && endField && (
              <div className="mb-4">
                <TimeRangeControl
                  value={{
                    start: (current[startField.slug] as string | null) ?? null,
                    end: (current[endField.slug] as string | null) ?? null,
                    allDay: allDayField ? current[allDayField.slug] === true : false,
                  }}
                  onChange={setRange}
                  hasAllDay={Boolean(allDayField)}
                  readOnly={locked.has(startField.slug)}
                />
              </div>
            )}

            {properties.length > 0 && (
              <div className="mb-6 grid grid-cols-1 gap-4">
                {properties
                  // Engine-written and source-kept fields show once they hold something.
                  .filter((f) => !(f.options.readonly && (isDraft || isEmptyValue(recordQuery.data?.values[f.slug]))))
                  .filter((f) => !(locked.has(f.slug) && (isEmptyValue(current[f.slug]) || current[f.slug] === false)))
                  .map((f) => (
                    <PropertyRow key={f.id} field={f}>
                      {f.slug === destination?.field && !locked.has(f.slug) ? (
                        <DestinationControl
                          value={String(current[f.slug] ?? "")}
                          onChange={(v) => set(f.slug, v)}
                          targets={destination.targets}
                          currentLabel={typeof binding?.live.calendarLabel === "string" ? binding.live.calendarLabel : undefined}
                        />
                      ) : f.slug === destination?.field ? (
                        <p className="font-mono text-base text-slate">
                          {destination.targets.find((t) => t.value === current[f.slug])?.label ?? (String(current[f.slug] ?? "") || "Local only")}
                        </p>
                      ) : f.options.readonly || locked.has(f.slug) ? (
                        <ReadonlyValue field={f} value={f.options.readonly ? recordQuery.data?.values[f.slug] : current[f.slug]} onNavigate={onNavigate} />
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

            {binding && <LiveValues binding={binding} />}

            {related.length > 0 && <RelatedSection groups={related} onNavigate={onNavigate} />}

            <ExhibitLinksLayout
              exhibitId={recordId}
              hideIds={shownLinks}
              renderIcon={(chamber) => getChamberIcon(chamber)}
              onNavigate={onNavigate}
              editable
              onCreateReference={type && creatable ? (title) => quickCreateRecord(type, title) : undefined}
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
                      {binding?.actions.map((a) => (
                        <button
                          key={a.id}
                          disabled={actionMutation.isPending}
                          onClick={() => actionMutation.mutate(a.id)}
                          className="tap-target text-accent hover:underline disabled:text-dust"
                        >
                          {a.label}
                        </button>
                      ))}
                      {def.actions.map((a) => {
                        const f = def.fields.find((x) => x.id === a.field);
                        return (
                          <button key={a.field} onClick={() => toggle(a.field)} className="tap-target text-accent hover:underline">
                            {f && current[f.slug] === true ? a.on : a.off}
                          </button>
                        );
                      })}
                      {!binding?.lockReason && bound?.delete !== "never" && (
                        <button onClick={() => setConfirmingDelete(true)} className="tap-target text-alert hover:underline">
                          Delete
                        </button>
                      )}
                    </>
                  )}
                </ExhibitActionBar>
              }
            >
              {Live && binding && recordId ? (
                <Live recordId={recordId} sourceKey={recordQuery.data?.provenance?.key ?? ""} binding={binding} runAction={runSilently} />
              ) : bodyField && locked.has(bodyField.slug) ? (
                <ReadonlyValue field={bodyField} value={current[bodyField.slug]} onNavigate={onNavigate} />
              ) : bodyField ? (
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
                message={`Delete "${titleField ? String(current[titleField.slug] ?? "") : def.label}"? This cannot be undone.${
                  linkingCount > 0 ? ` ${linkingCount === 1 ? "1 record links" : `${linkingCount} records link`} to it; those links will be cleared.` : ""
                }`}
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
