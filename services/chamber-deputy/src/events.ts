import { createPublishEvent } from "@congress/chamber-kit";
import { env } from "./env.js";

// deputy.directive_run - the one event type for every run, whichever
// trigger produced it (see engine.ts's reportRun): always published for a
// directive-scoped manual/scheduled run, only when it actually took a real
// action for a bundled chat run. Logs Chamber's own rule (recordToHistory/
// notify) decides whether that's worth recording/notifying; Deputy has no
// "how noisy should I be" logic of its own.
export const publishEvent = createPublishEvent({
  chamber: "deputy",
  capitolUrl: env.CAPITOL_URL,
  internalToken: env.CONGRESS_INTERNAL_TOKEN,
});
