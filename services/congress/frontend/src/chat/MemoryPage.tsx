import { useEffect, useRef, useState } from "react";
import { ChatBackButton, ChatLink } from "./chatMotion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Fact, Recurrence, TrackedItem, UpdateTrackedItemRequest, WatchEvent } from "@congress/shared-types";
import { ChatMarkdown, ConfirmSheet, showToast, useAutosave } from "@congress/congress-ui";
import {
  addFact,
  aiFactsQueryKey,
  aiTrackingQueryKey,
  checkTrackedItem,
  deleteFact,
  deleteTrackedItem,
  fetchFacts,
  fetchTracking,
  updateFact,
  updateTrackedItem,
} from "@/lib/aiApi";
import { useChatNavigation } from "./chatNav";
import { listStamp } from "./chatFormat";
import "./memory.css";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n: number) => String(n).padStart(2, "0");

function describe(r: Recurrence): string {
  if (r.type === "interval") {
    const m = r.everyMinutes;
    if (m % 1440 === 0) return m === 1440 ? "Every day" : `Every ${m / 1440} days`;
    if (m % 60 === 0) return m === 60 ? "Every hour" : `Every ${m / 60} hours`;
    return `Every ${m} minutes`;
  }
  if (r.type === "daily") return `Daily at ${pad(r.hour)}:${pad(r.minute)}`;
  return `${DAYS[r.dayOfWeek]}s at ${pad(r.hour)}:${pad(r.minute)}`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const soon = d.getTime() - Date.now();
  const time = d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  if (soon < 0) return `due now (${time})`;
  return time;
}

// ISO <-> the value a datetime-local input wants (the device's zone).
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function RecurrenceEditor({ value, onChange }: { value: Recurrence | null; onChange: (r: Recurrence | null) => void }) {
  const type = value?.type ?? "none";
  const time = value && value.type !== "interval" ? `${pad(value.hour)}:${pad(value.minute)}` : "09:00";
  const [h, m] = time.split(":").map(Number) as [number, number];
  return (
    <div className="memory-recurrence">
      <select
        className="memory-input"
        value={type}
        aria-label="Repeat"
        onChange={(e) => {
          const t = e.target.value;
          if (t === "none") onChange(null);
          else if (t === "interval") onChange({ type: "interval", everyMinutes: 1440 });
          else if (t === "daily") onChange({ type: "daily", hour: h, minute: m });
          else onChange({ type: "weekly", dayOfWeek: 1, hour: h, minute: m });
        }}
      >
        <option value="none">Doesn't repeat</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="interval">Every…</option>
      </select>
      {value?.type === "interval" ? (
        <label className="memory-inline">
          <input
            className="memory-input memory-input--short"
            type="number"
            min={1}
            value={Math.max(1, Math.round(value.everyMinutes / 60))}
            onChange={(e) => onChange({ type: "interval", everyMinutes: Math.max(1, Number(e.target.value) || 1) * 60 })}
          />
          hours
        </label>
      ) : null}
      {value?.type === "weekly" ? (
        <select className="memory-input" value={value.dayOfWeek} aria-label="Day" onChange={(e) => onChange({ ...value, dayOfWeek: Number(e.target.value) })}>
          {DAYS.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </select>
      ) : null}
      {value && value.type !== "interval" ? (
        <input
          className="memory-input memory-input--short"
          type="time"
          aria-label="Time"
          value={time}
          onChange={(e) => {
            const [hh, mm] = e.target.value.split(":").map(Number);
            if (hh === undefined || mm === undefined || Number.isNaN(hh) || Number.isNaN(mm)) return;
            onChange({ ...value, hour: hh, minute: mm });
          }}
        />
      ) : null}
    </div>
  );
}

function WatchEditor({ value, onChange }: { value: WatchEvent[]; onChange: (w: WatchEvent[]) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="memory-watch">
      {value.map((w, i) => (
        <div key={`${w.type}-${i}`} className="memory-watch-row">
          <code>{w.type}</code>
          <label className="memory-inline">
            <input type="checkbox" checked={w.immediate} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, immediate: e.target.checked } : x)))} />
            act right away
          </label>
          <button type="button" className="chat-meta-action" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`Stop watching ${w.type}`}>
            Remove
          </button>
        </div>
      ))}
      <form
        className="memory-watch-add"
        onSubmit={(e) => {
          e.preventDefault();
          const type = draft.trim();
          if (!type || value.some((w) => w.type === type)) return;
          onChange([...value, { type, immediate: true }]);
          setDraft("");
        }}
      >
        <input className="memory-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Event type, e.g. tasks.overdue" aria-label="Watch an event" />
        <button type="submit" className="ask-secondary" disabled={!draft.trim()}>
          Add
        </button>
      </form>
    </div>
  );
}

type Draft = Pick<TrackedItem, "title" | "body" | "recurrence" | "watchEvents"> & { nextCheckLocal: string };

function TrackedEditor({ item }: { item: TrackedItem }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>({
    title: item.title,
    body: item.body,
    recurrence: item.recurrence,
    watchEvents: item.watchEvents,
    nextCheckLocal: toLocalInput(item.nextCheckAt),
  });
  useAutosave({
    value: draft,
    onSave: (d) => {
      const patch: UpdateTrackedItemRequest = {
        title: d.title.trim() || item.title,
        body: d.body,
        recurrence: d.recurrence,
        watchEvents: d.watchEvents,
        nextCheckAt: d.nextCheckLocal ? new Date(d.nextCheckLocal).toISOString() : null,
      };
      updateTrackedItem(item.id, patch)
        .then(() => queryClient.invalidateQueries({ queryKey: aiTrackingQueryKey }))
        .catch(() => showToast("Couldn't save", "error"));
    },
  });
  return (
    <div className="memory-editor">
      <label className="memory-field">
        <span>Title</span>
        <input className="memory-input" value={draft.title} maxLength={120} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
      </label>
      <label className="memory-field">
        <span>Notes for Congress</span>
        <textarea className="memory-input memory-textarea" rows={4} value={draft.body} maxLength={4000} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} />
      </label>
      <label className="memory-field">
        <span>Next check</span>
        <input className="memory-input" type="datetime-local" value={draft.nextCheckLocal} onChange={(e) => setDraft((d) => ({ ...d, nextCheckLocal: e.target.value }))} />
      </label>
      <div className="memory-field">
        <span>Repeat</span>
        <RecurrenceEditor value={draft.recurrence} onChange={(recurrence) => setDraft((d) => ({ ...d, recurrence }))} />
      </div>
      <div className="memory-field">
        <span>Watched events</span>
        <WatchEditor value={draft.watchEvents} onChange={(watchEvents) => setDraft((d) => ({ ...d, watchEvents }))} />
      </div>
    </div>
  );
}

function TrackedCard({ item }: { item: TrackedItem }) {
  const queryClient = useQueryClient();
  const nav = useChatNavigation();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: aiTrackingQueryKey });
  const setStatus = useMutation({ mutationFn: (status: TrackedItem["status"]) => updateTrackedItem(item.id, { status }), onSettled: refresh });
  const check = useMutation({
    mutationFn: () => checkTrackedItem(item.id),
    onSuccess: () => showToast("Checking now"),
    onError: (err) => showToast(err instanceof Error ? err.message : "Couldn't start a check", "error"),
    onSettled: refresh,
  });
  const remove = useMutation({ mutationFn: () => deleteTrackedItem(item.id), onSettled: refresh });
  const closed = item.status === "done" || item.status === "dropped";

  const schedule = [
    item.status === "paused" ? "Paused" : closed ? (item.status === "done" ? "Done" : "Dropped") : item.nextCheckAt ? `Next check ${formatWhen(item.nextCheckAt)}` : "No check scheduled",
    item.recurrence ? describe(item.recurrence) : null,
  ].filter(Boolean);

  return (
    <li className={`memory-card${item.status !== "active" ? " memory-card--inactive" : ""}`}>
      <div className="memory-card-head">
        <h3 className="memory-card-title">{item.title}</h3>
        {item.checking ? <span className="chat-spinner" aria-label="Checking" /> : null}
      </div>
      <p className="memory-card-meta">{schedule.join(" · ")}</p>
      {item.watchEvents.length ? (
        <div className="memory-chips">
          {item.watchEvents.map((w) => (
            <span key={w.type} className="memory-chip" title={w.immediate ? "Checks as soon as it happens" : "Noticed at the next check"}>
              {w.immediate ? "⚡ " : ""}
              {w.type}
            </span>
          ))}
        </div>
      ) : null}
      {item.body.trim() && !editing ? <ChatMarkdown text={item.body} className="memory-card-body" {...nav} /> : null}
      {item.refs.length && !editing ? <ChatMarkdown text={item.refs.join(" ")} className="memory-card-refs" {...nav} /> : null}
      {editing ? <TrackedEditor item={item} /> : null}
      <p className="memory-card-foot">
        {item.lastCheckedAt ? `Last checked ${listStamp(new Date(item.lastCheckedAt))}` : "Not checked yet"}
        {item.source === "directive" ? " · from a Deputy directive" : ""}
      </p>
      <div className="memory-actions">
        {!closed ? (
          <button type="button" className="ask-secondary" onClick={() => check.mutate()} disabled={check.isPending || item.checking}>
            {item.checking ? "Checking —" : "Check now"}
          </button>
        ) : null}
        {item.threadId ? (
          <ChatLink to={`/chat/${item.threadId}`} className="ask-secondary">
            Chat
          </ChatLink>
        ) : null}
        <button type="button" className="chat-meta-action" onClick={() => setEditing((e) => !e)}>
          {editing ? "Close" : "Edit"}
        </button>
        {item.status === "active" ? (
          <button type="button" className="chat-meta-action" onClick={() => setStatus.mutate("paused")}>
            Pause
          </button>
        ) : (
          <button type="button" className="chat-meta-action" onClick={() => setStatus.mutate("active")}>
            {closed ? "Reopen" : "Resume"}
          </button>
        )}
        {!closed ? (
          <button type="button" className="chat-meta-action" onClick={() => setStatus.mutate("done")}>
            Done
          </button>
        ) : null}
        <button type="button" className="chat-meta-action memory-danger" onClick={() => setConfirmDelete(true)}>
          Delete
        </button>
      </div>
      <ConfirmSheet
        open={confirmDelete}
        title="Stop tracking this?"
        message="Congress will forget it entirely. Marking it done keeps it in the history."
        onConfirm={() => {
          setConfirmDelete(false);
          remove.mutate();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </li>
  );
}

function FactRow({ fact }: { fact: Fact }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState(fact.text);
  const refresh = () => queryClient.invalidateQueries({ queryKey: aiFactsQueryKey });
  useAutosave({
    value: text,
    enabled: text.trim().length > 0,
    onSave: (t) => void updateFact(fact.id, t.trim()).then(refresh).catch(() => showToast("Couldn't save", "error")),
  });
  return (
    <li className="memory-fact">
      <textarea
        className="memory-input memory-fact-input memory-textarea"
        value={text}
        maxLength={500}
        rows={Math.min(5, Math.max(1, Math.ceil(text.length / 34)))}
        onChange={(e) => setText(e.target.value.replace(/\n/g, " "))}
        aria-label="Fact"
      />
      <button
        type="button"
        className="chat-meta-action memory-danger"
        aria-label="Forget this"
        onClick={() => void deleteFact(fact.id).then(refresh)}
      >
        Forget
      </button>
    </li>
  );
}

function AddFact() {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <form
      className="memory-fact memory-fact--add"
      onSubmit={async (e) => {
        e.preventDefault();
        const value = text.trim();
        if (!value) return;
        try {
          await addFact(value);
          setText("");
          void queryClient.invalidateQueries({ queryKey: aiFactsQueryKey });
          inputRef.current?.focus();
        } catch {
          showToast("Couldn't add that", "error");
        }
      }}
    >
      <input ref={inputRef} className="memory-input memory-fact-input" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder="Add something Congress should know" enterKeyHint="done" />
      <button type="submit" className="ask-secondary" disabled={!text.trim()}>
        Add
      </button>
    </form>
  );
}

export function MemoryPage() {
  const [showClosed, setShowClosed] = useState(false);
  const tracking = useQuery({ queryKey: [...aiTrackingQueryKey, showClosed], queryFn: () => fetchTracking(showClosed), refetchInterval: 10_000 });
  const facts = useQuery({ queryKey: aiFactsQueryKey, queryFn: fetchFacts });
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => scrollRef.current?.scrollTo({ top: 0 }), []);
  const items = tracking.data ?? [];
  const open = items.filter((i) => i.status === "active" || i.status === "paused");
  const closed = items.filter((i) => i.status === "done" || i.status === "dropped");

  return (
    <div className="chat-thread">
      <header className="chat-header">
        <ChatBackButton />
        <div className="chat-header-text">
          <h1 className="chat-title">Memory</h1>
          <p className="chat-subtitle">What Congress keeps in mind</p>
        </div>
      </header>
      <div className="chat-scroll" ref={scrollRef}>
        <div className="memory-page">
          <section>
            <h2 className="memory-heading">Tracking</h2>
            {tracking.isLoading ? <p className="chat-loading">Loading —</p> : null}
            {tracking.isSuccess && open.length === 0 ? (
              <p className="memory-empty">Nothing tracked yet. In a chat, try “keep an eye on…”, “remind me every Monday to…”, or “tell me when a task goes overdue”.</p>
            ) : null}
            <ul className="memory-list">
              {open.map((item) => (
                <TrackedCard key={item.id} item={item} />
              ))}
            </ul>
            <button type="button" className="chat-archived-toggle" onClick={() => setShowClosed((s) => !s)} aria-expanded={showClosed}>
              {showClosed ? "Hide finished" : "Show finished"}
            </button>
            {showClosed ? (
              closed.length ? (
                <ul className="memory-list">
                  {closed.map((item) => (
                    <TrackedCard key={item.id} item={item} />
                  ))}
                </ul>
              ) : (
                <p className="memory-empty">Nothing finished yet.</p>
              )
            ) : null}
          </section>
          <section>
            <h2 className="memory-heading">What Congress knows about you</h2>
            {facts.isSuccess && facts.data.length === 0 ? <p className="memory-empty">Nothing yet. Congress remembers things you tell it, and you can add them here.</p> : null}
            <ul className="memory-facts">
              {(facts.data ?? []).map((f) => (
                <FactRow key={f.id} fact={f} />
              ))}
            </ul>
            <AddFact />
          </section>
        </div>
      </div>
    </div>
  );
}
