import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@congress/congress-ui";
import { fetchRecentRuns } from "@/lib/api";
import type { DeputyRun } from "../../../src/types";

const TRIGGER_LABEL: Record<DeputyRun["trigger"], string> = { chat: "chat", periodic: "periodic checkup", urgent: "urgent" };

function RunRow({ run }: { run: DeputyRun }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="border border-dust p-3 font-mono text-xs text-ink">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-center justify-between gap-2 text-left">
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-dust">{new Date(run.createdAt).toLocaleString()}</span>
          <span className="shrink-0 uppercase tracking-wide text-dust">{TRIGGER_LABEL[run.trigger]}</span>
          <span className="min-w-0 truncate">{run.finalResponse || (run.ok ? "(no action taken)" : (run.errorMessage ?? "failed"))}</span>
        </span>
        <span className={`shrink-0 ${run.ok ? "text-accent" : "text-alert"}`}>{run.ok ? "ok" : "failed"}</span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-dust pt-3">
          {run.errorMessage && <p className="text-alert">{run.errorMessage}</p>}
          <div>
            <p className="mb-1 text-dust">Prompt</p>
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap bg-ink/[0.03] p-2">{run.prompt}</pre>
          </div>
          <div>
            <p className="mb-1 text-dust">
              Tool calls ({run.transcript.length}){run.costUsd != null && ` · $${run.costUsd.toFixed(4)}`}
              {run.durationMs != null && ` · ${(run.durationMs / 1000).toFixed(1)}s`}
            </p>
            {run.transcript.length === 0 && <p className="text-dust">— None —</p>}
            {run.transcript.length > 0 && (
              <ul className="space-y-2">
                {run.transcript.map((entry, i) => (
                  <li key={i} className="border border-dust p-2">
                    <p className={entry.error ? "text-alert" : "text-ink"}>{entry.toolName}</p>
                    <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-dust">{JSON.stringify(entry.input, null, 2)}</pre>
                    {entry.error && <p className="mt-1 text-alert">{entry.error}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

export function RunHistoryPage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ["runs", "recent"], queryFn: fetchRecentRuns });

  return (
    <section>
      <PageHeader title="Run History" />
      {isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
      {isError && <p className="font-mono text-sm text-alert">Failed to reach the runs API.</p>}
      {!isLoading && !isError && data?.length === 0 && <p className="font-mono text-sm text-dust">— No runs yet —</p>}
      {!isLoading && !isError && data && data.length > 0 && (
        <ul className="space-y-2">
          {data.map((run) => (
            <RunRow key={run.id} run={run} />
          ))}
        </ul>
      )}
    </section>
  );
}
