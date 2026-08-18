import type { EventLogEntry } from "@congress/shared-types";
import { getSettings } from "./settings.js";
import { listEnabledDirectives } from "./directives.js";

// Layer 1 (docs/deputy-chamber-plan.md §4): code-owned, not editable via UI.
// Frames the one hard capability boundary (MCP tools only, never Bash/
// filesystem - see engine.ts's --allowedTools "mcp__*") and the tone this
// Chamber is meant to have (functional operator, not a chat companion - see
// §1). The trailing-PRIORITY-line convention is how Deputy (which exposes no
// MCP tools of its own, see mcp/tools.ts) signals a deputy.report's priority
// without a bespoke reporting tool - engine.ts strips it back out of the
// reply before storing/displaying it.
const BASE_IDENTITY_PROMPT = `You are Deputy, a functional operator over Congress - a personal, self-hosted productivity system - and its Chambers. You check things, act on standing instructions, and do small management tasks. You are not a chat companion and this is not open-ended conversation: keep replies terse and transactional.

You act only through the MCP tools available to you in this session - each one belongs to another Chamber's own API. You have no Bash, filesystem, or web access, and none is available to you regardless of what you might otherwise reach for.

If, and only if, you actually called a tool this run to check or change something, end your reply with one line, exactly: "PRIORITY: <low|normal|high|urgent>" - how important this run's outcome is for the owner to know about. Omit that line entirely if you took no action this run.`;

function baseIdentitySection(): string {
  return `${BASE_IDENTITY_PROMPT}\n\nCurrent server time: ${new Date().toISOString()}`;
}

async function directivesSection(): Promise<string> {
  const enabled = await listEnabledDirectives();
  if (enabled.length === 0) return "No standing directives are configured yet.";
  return enabled.map((d) => `### ${d.title}\n${d.body}`).join("\n\n");
}

function formatEvents(events: EventLogEntry[]): string {
  if (events.length === 0) return "(none)";
  return events.map((e) => `- [${e.occurredAt}] ${e.chamber}.${e.type}: ${JSON.stringify(e.payload)}`).join("\n");
}

export interface PromptContext {
  trigger: "chat" | "periodic" | "urgent";
  chatMessage?: string;
  events?: EventLogEntry[];
}

// Builds the full prompt fresh on every invocation - nothing is baked into a
// static system prompt file (docs/deputy-chamber-plan.md §4). Layer 3 (all
// enabled directives) is always included regardless of trigger kind, since a
// time-based directive has no corresponding event to react to at all.
export async function buildPrompt(ctx: PromptContext): Promise<string> {
  const settings = await getSettings();

  const parts = [baseIdentitySection()];

  if (settings.personaPrompt.trim()) {
    parts.push(`## Persona\n${settings.personaPrompt.trim()}`);
  }

  parts.push(`## Standing directives\n${await directivesSection()}`);

  if (ctx.trigger === "chat") {
    parts.push(
      `## Message from the owner\nThis is a short functional exchange about app/data management, not an open-ended conversation.\n\n${ctx.chatMessage ?? ""}`
    );
  } else if (ctx.trigger === "periodic") {
    parts.push(
      `## Periodic checkup\nThis is a scheduled checkup, not a reaction to any one event - consider every enabled directive above, including purely time-based ones. Consult your own journal (a note you maintain in Notes Chamber, if you keep one) to avoid repeating a same-day directive you've already handled. Events published since the last checkup:\n${formatEvents(ctx.events ?? [])}`
    );
  } else {
    parts.push(
      `## Urgent event\nThis event was marked urgent and preempted the next scheduled checkup - handle it now rather than waiting:\n${formatEvents(ctx.events ?? [])}`
    );
  }

  return parts.join("\n\n");
}
