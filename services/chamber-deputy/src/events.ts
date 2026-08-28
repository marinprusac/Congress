import { createPublishEvent } from "@congress/chamber-kit";
import { env } from "./env.js";

// deputy.directive_run - the one event type for every run, whichever of the
// four triggers produced it (see engine.ts's reportRun): always published
// for a directive-scoped manual/scheduled run, only when it actually took a
// real action for a bundled chat/urgent run. Logs Chamber's own rules (a
// minPriority threshold) decide whether that's worth recording/notifying;
// Deputy has no bespoke "how noisy should I be" logic of its own beyond
// tagging payload.priority - see docs/deputy-chamber-plan.md §7.
export const publishEvent = createPublishEvent({
  chamber: "deputy",
  capitolUrl: env.CAPITOL_URL,
  internalToken: env.CONGRESS_INTERNAL_TOKEN,
});
