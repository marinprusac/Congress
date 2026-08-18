import { createPublishEvent } from "@congress/chamber-kit";
import { env } from "./env.js";

// deputy.report - published only when a run actually took a real action
// (see engine.ts), never on every tick. Logs Chamber's own rules (a
// minPriority threshold) decide whether that's worth recording/notifying;
// Deputy has no bespoke "how noisy should I be" logic of its own beyond
// tagging payload.priority - see docs/deputy-chamber-plan.md §7.
export const publishEvent = createPublishEvent({
  chamber: "deputy",
  capitolUrl: env.CAPITOL_URL,
  internalToken: env.CONGRESS_INTERNAL_TOKEN,
});
