import type { ChamberSubscription } from "@congress/shared-types";

// Deputy's own logic never filters by event type - every directive is
// free-text (db/schema.ts's directives table) and a scheduled directive's
// own prompt just dumps everything buffered since it last ran (see
// promptAssembly.ts's formatEvents) - so there's nothing to compute here.
// "*" is the wildcard convention (chamberSubscriptionSchema, shared-types/
// events.ts) for "every event type": Congress's own coarse per-type gate
// has nothing narrower to apply for this Chamber.
export function computeSubscriptions(): ChamberSubscription[] {
  return [{ type: "*" }];
}
