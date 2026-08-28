// Tracks which directive, if any, currently has a `claude` run actually in
// flight - jobQueue.ts is concurrency-1, so at most one directive-tied run
// is ever executing at once. Chat/urgent runs have no directive and never
// touch this. Exposed via GET /api/directives/running so the directives
// list's play-button ring can show a live spinner for a run kicked off
// anywhere - this tab's own play button, another tab, or checkup.ts's own
// scheduler - not just ones this browser session started itself.
//
// Deliberately set from inside the queued job closure (server.ts/checkup.ts
// wrap the function passed to enqueue(), not the enqueue() call itself) so
// this reflects a directive actually executing right now, not merely
// queued - checkup.ts can enqueue several due directives back to back
// without awaiting each one, and only the one the concurrency-1 queue has
// actually dequeued should ever show as running.
let runningDirectiveId: number | null = null;

export function getRunningDirectiveId(): number | null {
  return runningDirectiveId;
}

export async function withRunningDirective<T>(directiveId: number, fn: () => Promise<T>): Promise<T> {
  runningDirectiveId = directiveId;
  try {
    return await fn();
  } finally {
    runningDirectiveId = null;
  }
}
