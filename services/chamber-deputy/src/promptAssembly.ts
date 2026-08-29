import type { EventLogEntry } from "@congress/shared-types";
import { getSettings } from "./settings.js";
import { listEnabledDirectives } from "./directives.js";
import type { DirectiveSummary } from "./types.js";

// Layer 1 (docs/deputy-chamber-plan.md §4): code-owned, not editable via UI.
// Frames the one hard capability boundary (MCP tools only, never Bash/
// filesystem - see engine.ts's --allowedTools "mcp__*") and the tone this
// Chamber is meant to have (functional operator, not a chat companion - see
// §1).
const BASE_IDENTITY_PROMPT = `You are Deputy, a functional operator over Congress - a personal, self-hosted productivity system - and its Chambers. You check things, act on standing instructions, and do small management tasks. You are not a chat companion and this is not open-ended conversation: keep replies terse and transactional.

You act only through the MCP tools available to you in this session - each one belongs to another Chamber's own API. You have no Bash, filesystem, or web access, and none is available to you regardless of what you might otherwise reach for.`;

function baseIdentitySection(): string {
  return `${BASE_IDENTITY_PROMPT}\n\nCurrent server time: ${new Date().toISOString()}`;
}

// A "scheduled"/"manual" run is scoped to exactly one directive (its own
// timer, or the owner's play button) - that one directive is its whole
// mandate, not a bundle. "chat"/"urgent" still see every enabled directive
// at once, same as before this split.
async function directivesSection(directive?: DirectiveSummary): Promise<string> {
  if (directive) return `### ${directive.title}\n${directive.body}`;
  const enabled = await listEnabledDirectives();
  if (enabled.length === 0) return "No standing directives are configured yet.";
  return enabled.map((d) => `### ${d.title}\n${d.body}`).join("\n\n");
}

function formatEvents(events: EventLogEntry[]): string {
  if (events.length === 0) return "(none)";
  return events.map((e) => `- [${e.occurredAt}] ${e.chamber}.${e.type}: ${JSON.stringify(e.payload)}`).join("\n");
}

export interface PromptContext {
  trigger: "chat" | "scheduled" | "manual";
  chatMessage?: string;
  events?: EventLogEntry[];
  // The one directive this run is about - only set for "scheduled"/"manual"
  // (see directivesSection above). Absent for "chat", which still sees
  // every enabled directive bundled together.
  directive?: DirectiveSummary;
}

// Builds the full prompt fresh on every invocation - nothing is baked into a
// static system prompt file (docs/deputy-chamber-plan.md §4).
export async function buildPrompt(ctx: PromptContext): Promise<string> {
  const settings = await getSettings();

  const parts = [baseIdentitySection()];

  if (settings.contextPrompt.trim()) {
    parts.push(`## Context\n${settings.contextPrompt.trim()}`);
  }

  const heading = ctx.directive ? "## This run's directive" : "## Standing directives";
  parts.push(`${heading}\n${await directivesSection(ctx.directive)}`);

  if (ctx.trigger === "chat") {
    parts.push(
      `## Message from the owner\nThis is a short functional exchange about app/data management, not an open-ended conversation.\n\n${ctx.chatMessage ?? ""}`
    );
  } else if (ctx.trigger === "scheduled") {
    parts.push(
      `## Scheduled run\nThis directive's own timer came due - handle it now, considering only this one directive. Consult your own journal (a note you maintain in Notes Chamber, if you keep one) to avoid repeating work you've already done. Events received since this directive last ran:\n${formatEvents(ctx.events ?? [])}`
    );
  } else {
    parts.push(`## Manual run\nThe owner asked you to run this one directive right now, outside its normal schedule.`);
  }

  return parts.join("\n\n");
}
