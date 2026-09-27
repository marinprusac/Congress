import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AiActivityEntry } from "@congress/shared-types";
import { CapitolMark, getChamberIcon, type AiLiveActivity } from "@congress/congress-ui";
import { aiRunQueryKey, fetchAiRun } from "@/lib/aiApi";
import { durationLabel, stringifyToolValue, toolLabel } from "./chatFormat";

type Activity = AiLiveActivity | AiActivityEntry;

function ToolIcon({ chamber }: { chamber: string | null }) {
  if (!chamber || chamber === "congress") return <CapitolMark className="chat-tool-icon" />;
  return getChamberIcon(chamber, { className: "chat-tool-icon" });
}

function StatusGlyph({ done, error }: { done: boolean; error: boolean }) {
  if (!done) return <span className="chat-spinner" aria-label="Running" />;
  return error ? (
    <span className="chat-tool-status chat-tool-status--error" aria-label="Failed">
      ✕
    </span>
  ) : (
    <span className="chat-tool-status" aria-label="Done">
      ✓
    </span>
  );
}

function ActivityRow({ entry }: { entry: Activity }) {
  const [open, setOpen] = useState(false);
  if (entry.type === "note") return <p className="chat-activity-note">{entry.text}</p>;
  const { chamber, label } = toolLabel(entry.toolName);
  const done = "done" in entry ? entry.done : true;
  const error = Boolean(entry.error);
  return (
    <li className="chat-tool">
      <button type="button" className="chat-tool-row" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ToolIcon chamber={chamber} />
        <span className="chat-tool-label">
          {chamber && chamber !== "congress" ? <span className="chat-tool-chamber">{chamber}</span> : null}
          {label}
        </span>
        <StatusGlyph done={done} error={error} />
      </button>
      {open && (
        <div className="chat-tool-detail">
          <p className="chat-tool-detail-label">Input</p>
          <pre>{stringifyToolValue(entry.input)}</pre>
          {done && (
            <>
              <p className="chat-tool-detail-label">{error ? "Error" : "Result"}</p>
              <pre>{error ? entry.error : stringifyToolValue(entry.output ?? null)}</pre>
            </>
          )}
        </div>
      )}
    </li>
  );
}

export function ActivityList({ activity }: { activity: Activity[] }) {
  return (
    <ul className="chat-activity-list">
      {activity.map((entry, i) => (
        <ActivityRow key={entry.type === "tool" ? entry.toolUseId : `note-${i}`} entry={entry} />
      ))}
    </ul>
  );
}

function summary(count: number, durationMs: number | null, live: boolean): string {
  const tools = count === 1 ? "1 tool" : `${count} tools`;
  if (live) return count === 0 ? "Thinking" : `Using ${tools}`;
  const duration = durationLabel(durationMs);
  return `Used ${tools}${duration ? ` · ${duration}` : ""}`;
}

// The live run's activity: expanded, newest step visible.
export function LiveActivity({ activity }: { activity: AiLiveActivity[] }) {
  const [open, setOpen] = useState(true);
  const tools = activity.filter((a) => a.type === "tool");
  if (activity.length === 0) return null;
  return (
    <div className="chat-activity chat-activity--live">
      <button type="button" className="chat-activity-summary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="chat-spinner" aria-hidden="true" />
        {summary(tools.length, null, true)}
      </button>
      {open ? <ActivityList activity={activity} /> : null}
    </div>
  );
}

// A stored reply's activity, fetched only when opened.
export function StoredActivity({ runId, toolCallCount, durationMs }: { runId: string; toolCallCount: number; durationMs: number | null }) {
  const [open, setOpen] = useState(false);
  const run = useQuery({ queryKey: aiRunQueryKey(runId), queryFn: () => fetchAiRun(runId), enabled: open, staleTime: Infinity });
  if (toolCallCount === 0) return null;
  return (
    <div className="chat-activity">
      <button type="button" className="chat-activity-summary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`chat-chevron${open ? " chat-chevron--open" : ""}`} aria-hidden="true" />
        {summary(toolCallCount, durationMs, false)}
      </button>
      {open &&
        (run.isLoading ? (
          <p className="chat-activity-note">Loading —</p>
        ) : run.data ? (
          <ActivityList activity={run.data.activity} />
        ) : (
          <p className="chat-activity-note">Couldn't load the details.</p>
        ))}
    </div>
  );
}
