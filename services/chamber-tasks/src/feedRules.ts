import { closeness, formatDuration } from "@congress/chamber-kit";
import type { FeedCandidate } from "@congress/shared-types";
import type { TaskSummary } from "./types.js";

// Same 24h horizon as the due-soon event (notifications.ts's LOOKAHEAD_MS).
const DUE_SOON_WINDOW_MS = 24 * 60 * 60 * 1000;

// Tasks' home-feed candidates: an overdue task outranks almost anything, and
// a task due within a day climbs as its deadline nears. Tasks has no views -
// the tasks themselves are what reaches the feed. Pure - `open` is
// listOpenTasks()'s output.
export function taskFeedCandidates(open: TaskSummary[], now: Date): FeedCandidate[] {
  const items: FeedCandidate[] = [];
  for (const task of open) {
    if (!task.dueDate) continue;
    const untilDue = new Date(task.dueDate).getTime() - now.getTime();
    if (untilDue < 0) {
      items.push({ kind: "exhibit", exhibitId: `task-${task.id}`, score: 90, reason: `Overdue by ${formatDuration(untilDue)}` });
    } else if (untilDue <= DUE_SOON_WINDOW_MS) {
      items.push({
        kind: "exhibit",
        exhibitId: `task-${task.id}`,
        score: Math.round(60 + 25 * closeness(untilDue, DUE_SOON_WINDOW_MS)),
        reason: `Due in ${formatDuration(untilDue)}`,
      });
    }
  }
  return items;
}
