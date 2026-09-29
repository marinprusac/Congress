import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AiRunDetail } from "@congress/shared-types";
import { StackLink } from "@congress/congress-ui";
import { aiRunsQueryKey, fetchAiRuns } from "@/lib/aiApi";
import { ActivityList } from "@/chat/RunActivity";
import { durationLabel, listStamp } from "@/chat/chatFormat";

const KIND_LABEL: Record<string, string> = {
  chat: "Chat",
  answer: "Follow-up",
  remote: "Chamber",
  proactive: "Proactive",
  tracking: "Check",
  gate: "Look",
};

function verdictLine(run: AiRunDetail): string | null {
  const v = run.verdict as { act?: boolean; reason?: string; focus?: string; events?: number } | null;
  if (!v || typeof v !== "object") return null;
  if (run.kind === "gate") {
    const events = typeof v.events === "number" ? ` · ${v.events} event${v.events === 1 ? "" : "s"}` : "";
    return v.act ? `Acting: ${v.focus || v.reason || ""}${events}` : `Nothing to do${v.reason ? ` - ${v.reason}` : ""}${events}`;
  }
  return v.reason ? `Because: ${v.reason}` : null;
}

function RunRow({ run }: { run: AiRunDetail }) {
  const [open, setOpen] = useState(false);
  const verdict = verdictLine(run);
  const cost = run.costUsd != null ? `$${run.costUsd < 0.01 ? run.costUsd.toFixed(4) : run.costUsd.toFixed(2)}` : null;
  const facts = [durationLabel(run.durationMs), cost, run.toolCallCount ? `${run.toolCallCount} tool${run.toolCallCount === 1 ? "" : "s"}` : null].filter(Boolean);
  return (
    <li className="border-b border-dust/40 py-2">
      <button type="button" className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="min-w-0">
          <span className="font-mono text-[0.65rem] uppercase tracking-wider text-dust">{KIND_LABEL[run.kind] ?? run.kind}</span>
          <span className={`ml-2 font-mono text-[0.65rem] uppercase ${run.status === "ok" ? "text-accent" : run.status === "running" ? "text-slate" : "text-alert"}`}>{run.status}</span>
          {verdict ? <span className="block text-sm text-ink">{verdict}</span> : null}
          {run.errorMessage && run.status !== "ok" ? <span className="block text-sm text-slate">{run.errorMessage}</span> : null}
          {facts.length ? <span className="block font-mono text-[0.65rem] text-dust">{facts.join(" · ")}</span> : null}
        </span>
        <span className="shrink-0 font-mono text-[0.65rem] text-dust">{listStamp(new Date(run.startedAt))}</span>
      </button>
      {open ? (
        <div className="mt-2">
          {run.threadId ? (
            <StackLink to={`/chat/${run.threadId}`} className="font-mono text-xs text-accent underline">
              Open the chat
            </StackLink>
          ) : null}
          {run.activity.length ? <ActivityList activity={run.activity} /> : <p className="font-mono text-xs text-dust">No tools used.</p>}
        </div>
      ) : null}
    </li>
  );
}

// Recent AI runs of every kind - including the gate's "nothing to do" looks.
export function AiActivity() {
  const runs = useQuery({ queryKey: aiRunsQueryKey, queryFn: fetchAiRuns, refetchInterval: 30_000 });
  if (runs.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (!runs.data?.length) return <p className="font-mono text-sm text-dust">No runs yet.</p>;
  return (
    <ul>
      {runs.data.map((run) => (
        <RunRow key={run.id} run={run} />
      ))}
    </ul>
  );
}
