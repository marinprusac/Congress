import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useShellHosted,
  resolveChamberPath,
  useSearchableList,
  useListRowPrefetch,
  ListSearchInput,
  ListLoadingState,
  ListErrorState,
  ListEmptyState,
  showToast,
} from "@congress/congress-ui";
import { fetchDirectives, fetchDirective, searchDirectives, runDirective, fetchSettings } from "@/lib/api";
import { useDeputyRunStream } from "@/lib/useDeputyRunStream";
import { DirectiveProgressRing } from "@/components/DirectiveProgressRing";
import { directiveProgressFraction } from "@/lib/directiveProgress";
import { formatSchedule } from "@/lib/formatSchedule";

// Drives how fresh the list itself (lastRunAt/intervalMs) needs to be -
// short enough that a scheduled run firing elsewhere shows up promptly,
// cheap enough for a personal system's own SQLite to not think twice about.
// The rings' own "is this one running" state comes from useDeputyRunStream
// (live, pushed) instead of a poll now - see runningDirectiveId below.
const LIST_POLL_MS = 5_000;
const TICK_MS = 1_000;

// Ticks once a second so every row's progress ring keeps filling between
// polls, without each row owning its own timer.
function useNowTick(periodMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), periodMs);
    return () => clearInterval(id);
  }, [periodMs]);
  return now;
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="1.1em" height="1.1em">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em" className={className}>
      <path d="M6 4.5v15l13-7.5z" />
    </svg>
  );
}

export function DirectivesListPage() {
  const [query, setQuery] = useState("");
  const shellHosted = useShellHosted();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useSearchableList({
    queryKeyBase: "directives",
    query,
    fetchAll: fetchDirectives,
    fetchSearch: searchDirectives,
    refetchInterval: LIST_POLL_MS,
  });

  // Which directive (if any) currently has a run actually in flight -
  // covers a run kicked off anywhere (this tab's own play button, another
  // tab, or checkup.ts's own scheduler on the backend), not just this one,
  // pushed live over SSE rather than polled.
  const runStream = useDeputyRunStream();
  const runningDirectiveId = runStream.active && runStream.kind === "directive" ? runStream.directiveId : null;

  // A paused Deputy (the daily budget cap auto-pauses it, or the owner
  // paused it by hand in Settings) returns instantly, without ever spawning
  // a run - the Play button's own mutation still fires and still succeeds
  // (ok:false, with the reason), but that's easy to miss as a passing toast:
  // the ring just flashes into its spinning state and back out within a
  // fraction of a second, reading as "the button did nothing" rather than
  // "Deputy declined to run". Surfaced here as a standing banner instead so
  // it isn't a one-shot toast the owner has to catch mid-tap.
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const paused = settingsQuery.data?.paused ?? false;

  const now = useNowTick(TICK_MS);

  const prefetchDirective = useListRowPrefetch((id: number) => ["directive", id], fetchDirective);

  const runMutation = useMutation({
    mutationFn: (id: number) => runDirective(id),
    onSuccess: (result, id) => {
      queryClient.invalidateQueries({ queryKey: ["directive", id] });
      queryClient.invalidateQueries({ queryKey: ["directives"] });
      showToast(result.ok ? "Directive run complete" : (result.errorMessage ?? "Directive run failed."), result.ok ? "success" : "error");
    },
    onError: () => showToast("Failed to run directive.", "error"),
  });

  return (
    <section className="list-page">
      <ListSearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search directives —"
        newHref={resolveChamberPath("/directives/new", "deputy", shellHosted)}
        leading={
          <Link to={resolveChamberPath("/chat", "deputy", shellHosted)} className="list-search-new" aria-label="Chat" title="Chat">
            <ChatIcon />
          </Link>
        }
      />

      {paused && (
        <div className="mb-4 border border-alert px-3 py-2 font-mono text-sm text-alert">
          Deputy is paused{settingsQuery.data?.pausedReason ? ` — ${settingsQuery.data.pausedReason}` : "."}{" "}
          <Link to="/settings?from=deputy" className="underline">
            Resume in Settings
          </Link>
        </div>
      )}

      <div className="border-t border-dust">
        {isLoading && <ListLoadingState />}
        {isError && <ListErrorState label="Directives" />}
        {!isLoading && !isError && data?.length === 0 && <ListEmptyState label="directives" hasQuery={!!query} />}
        {!isLoading &&
          !isError &&
          data?.map((directive) => {
            const running = runningDirectiveId === directive.id || (runMutation.isPending && runMutation.variables === directive.id);
            const fraction = directiveProgressFraction(directive.lastRunAt, directive.nextRunAt, directive.createdAt, directive.scheduleCycleStart, now);
            const liveToolName = running && runningDirectiveId === directive.id ? runStream.toolCalls.at(-1)?.toolName : null;
            return (
              <div key={directive.id} className="flex items-stretch gap-1 border-b border-dust">
                <Link
                  to={resolveChamberPath(`/d/${directive.id}`, "deputy", shellHosted)}
                  onMouseEnter={() => prefetchDirective(directive.id)}
                  onFocus={() => prefetchDirective(directive.id)}
                  className="block min-w-0 flex-1 px-1 py-3 hover:bg-ink/[0.03]"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`font-display text-lg ${directive.enabled ? "text-ink" : "text-dust line-through"}`}>{directive.title}</span>
                    <span className="flex shrink-0 items-center gap-2 font-mono text-xs text-dust">
                      {formatSchedule(directive)}
                      {!directive.enabled && "disabled"}
                    </span>
                  </div>
                  {liveToolName ? (
                    <p className="mt-1 truncate font-mono text-xs text-accent">Calling {liveToolName} —</p>
                  ) : (
                    directive.body && <p className="mt-1 truncate text-sm text-slate">{directive.body}</p>
                  )}
                </Link>
                <button
                  type="button"
                  onClick={() => runMutation.mutate(directive.id)}
                  disabled={running || paused}
                  aria-label={`Run "${directive.title}" now`}
                  title={paused ? "Deputy is paused" : "Run now"}
                  className="tap-target flex shrink-0 items-center px-3 text-slate hover:text-accent disabled:opacity-50"
                >
                  <span className="directive-progress-ring-wrap">
                    <DirectiveProgressRing fraction={fraction} running={running} />
                    {!running && <PlayIcon className="directive-progress-ring-icon" />}
                  </span>
                </button>
              </div>
            );
          })}
      </div>
    </section>
  );
}
