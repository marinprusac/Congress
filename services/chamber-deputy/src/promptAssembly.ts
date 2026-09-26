import type { EventLogEntry } from "@congress/shared-types";
import type { DeputyRunTrigger, DirectiveSummary } from "./types.js";

function formatEvents(events: EventLogEntry[]): string {
  if (events.length === 0) return "(none)";
  return events.map((e) => `- [${e.occurredAt}] ${e.chamber}.${e.type}: ${JSON.stringify(e.payload)}`).join("\n");
}

export interface PromptContext {
  trigger: DeputyRunTrigger;
  // The one directive this run is about - every run is scoped to exactly
  // one: its own timer, its own trigger event, or the owner's play button.
  directive: DirectiveSummary;
  events?: EventLogEntry[];
}

// Deputy's own part of the prompt only - Congress frames it with the base
// identity, the current time, and the owner's context prompt (see
// services/congress/src/ai/prompt.ts). Built fresh on every run.
export function buildDirectivePrompt(ctx: PromptContext): string {
  const parts = [`## This run's directive\n### ${ctx.directive.title}\n${ctx.directive.body}`];

  if (ctx.trigger === "scheduled") {
    parts.push(
      `## Scheduled run\nThis directive's own timer came due - handle it now, considering only this one directive. Consult your own journal (a note you maintain in Notes Chamber, if you keep one) to avoid repeating work you've already done. Events received since this directive last ran:\n${formatEvents(ctx.events ?? [])}`
    );
  } else if (ctx.trigger === "event") {
    parts.push(
      `## Event-triggered run\nThis directive's own trigger event just fired - handle it now, considering only this one directive. The triggering event:\n${formatEvents(ctx.events ?? [])}`
    );
  } else {
    parts.push(`## Manual run\nThe owner asked you to run this one directive right now, outside its normal schedule.`);
  }

  return parts.join("\n\n");
}
