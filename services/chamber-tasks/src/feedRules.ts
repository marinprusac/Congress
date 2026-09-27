import { closeness, plainTextPreview } from "@congress/chamber-kit";
import type { FeedCandidate, FeedPreview } from "@congress/shared-types";
import { dueDay, dueDeadline } from "./dueDate.js";
import type { TaskSummary } from "./types.js";

// Deadlines are end of day, so 48h covers tasks due today and tomorrow.
const DUE_SOON_WINDOW_MS = 48 * 60 * 60 * 1000;

// What the feed shows inline for a task: the day it's due (no clock time -
// it's due until that day ends) and its description.
function preview(task: TaskSummary, day: string): FeedPreview {
  return { time: { label: "Due", start: day, allDay: true }, body: plainTextPreview(task.description) };
}

// Tasks' home-feed candidates: an overdue task outranks almost anything, and
// a task due today or tomorrow climbs as its deadline (the end of its due day in
// `timeZone`) nears. Pure - `open` is listOpenTasks()'s output.
export function taskFeedCandidates(open: TaskSummary[], now: Date, timeZone: string): FeedCandidate[] {
  const items: FeedCandidate[] = [];
  for (const task of open) {
    if (!task.dueDate) continue;
    const stored = new Date(task.dueDate);
    const untilDue = dueDeadline(stored, timeZone).getTime() - now.getTime();
    const exhibitId = `task-${task.id}`;
    if (untilDue <= 0) {
      items.push({ kind: "exhibit", exhibitId, score: 90, reason: "Overdue", preview: preview(task, dueDay(stored, timeZone)) });
    } else if (untilDue <= DUE_SOON_WINDOW_MS) {
      items.push({
        kind: "exhibit",
        exhibitId,
        score: Math.round(60 + 25 * closeness(untilDue, DUE_SOON_WINDOW_MS)),
        preview: preview(task, dueDay(stored, timeZone)),
      });
    }
  }
  return items;
}
