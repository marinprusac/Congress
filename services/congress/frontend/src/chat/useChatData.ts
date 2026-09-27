import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import type { AiMessage, AiThreadMessagesPage } from "@congress/shared-types";
import { useAiStream, useAiStreamEvents, type AiLiveRun } from "@congress/congress-ui";
import { notificationsQueryKey } from "@/lib/notifications";
import { aiAsksQueryKey, aiThreadMessagesQueryKey, aiThreadQueryKey, aiThreadsQueryKey, fetchAiThread, fetchAiThreadMessages, fetchAiThreads } from "@/lib/aiApi";

export type MessagesData = InfiniteData<AiThreadMessagesPage, number | undefined>;

export function useThreads(archived = false) {
  return useQuery({ queryKey: [...aiThreadsQueryKey, archived], queryFn: () => fetchAiThreads(archived) });
}

export function useThread(threadId: number) {
  return useQuery({ queryKey: aiThreadQueryKey(threadId), queryFn: () => fetchAiThread(threadId), retry: 1 });
}

// Pages walk backwards; flattened oldest-first for rendering.
export function useThreadMessages(threadId: number) {
  const query = useInfiniteQuery({
    queryKey: aiThreadMessagesQueryKey(threadId),
    queryFn: ({ pageParam }) => fetchAiThreadMessages(threadId, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.hasMore ? last.messages[0]?.id : undefined),
  });
  const messages: AiMessage[] = query.data ? [...query.data.pages].reverse().flatMap((p) => p.messages) : [];
  return { ...query, messages };
}

// Keeps chat queries current from the live stream.
export function useChatInvalidation(): void {
  const queryClient = useQueryClient();
  useAiStreamEvents((event) => {
    const threadId = event.type === "thread_updated" ? event.threadId : event.type === "run_finished" ? event.threadId : null;
    if (event.type === "connection" && event.connected) {
      void queryClient.invalidateQueries({ queryKey: ["congress", "ai"] });
      return;
    }
    if (threadId === null || threadId === undefined) return;
    void queryClient.invalidateQueries({ queryKey: aiThreadsQueryKey });
    void queryClient.invalidateQueries({ queryKey: aiThreadQueryKey(threadId) });
    void queryClient.invalidateQueries({ queryKey: aiAsksQueryKey });
    // Asks add and clear inbox entries too.
    void queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
  });
}

export type ThreadLiveState =
  | { phase: "idle" }
  | { phase: "queued"; runId: string; position: number }
  | { phase: "starting"; runId: string }
  | { phase: "running"; run: AiLiveRun };

// What this thread's pending reply is doing right now.
export function useThreadLive(threadId: number, pendingRunId: string | null, messages: AiMessage[], loaded: boolean): ThreadLiveState {
  const { run, queue } = useAiStream();
  if (run && run.threadId === threadId) {
    if (!run.finished) return { phase: "running", run };
    // Keep a finished stream on screen until its stored reply has arrived.
    const landed = messages.some((m) => m.runId === run.runId && m.role === "assistant");
    if (loaded && !landed) return { phase: "running", run };
  }
  if (!pendingRunId) return { phase: "idle" };
  // A stale pending id whose reply has already landed (e.g. an instant refusal).
  if (messages.some((m) => m.runId === pendingRunId && m.role === "assistant")) return { phase: "idle" };
  const position = queue.waiting.findIndex((e) => e.runId === pendingRunId);
  if (position >= 0 && queue.running) return { phase: "queued", runId: pendingRunId, position };
  return { phase: "starting", runId: pendingRunId };
}
