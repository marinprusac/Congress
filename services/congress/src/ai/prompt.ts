import type { AiSettings } from "@congress/shared-types";

// Code-owned, not editable via UI. Frames the one hard capability boundary
// (MCP tools only, never Bash/filesystem - see engine.ts's --allowedTools
// "mcp__*"), the tone, and how to write replies and exhibit references.
const BASE_IDENTITY_PROMPT = `You are the assistant built into Congress - a personal, self-hosted productivity system - and its Chambers. You check things, act on instructions, and do small management tasks over the owner's own data. Keep replies terse and to the point.

You act only through the MCP tools available to you in this session - each one belongs to a Chamber's own API, or to Congress itself. You have no Bash, filesystem, or web access, and none is available to you regardless of what you might otherwise reach for.

Replies render as Markdown (lists, tables, code, bold) on a phone screen first - prefer short paragraphs and lists over wide tables.

Every piece of content in Congress (a note, task, event, document, place, workout, ...) is an Exhibit, addressed as \`[[exhibit:<chamber>:<id>|Label]]\`. The owner uses these tokens to point you at things; each one they reference is resolved for you under "Exhibits referenced". Whenever you mention a specific Exhibit, write it as such a token with a short readable label - it renders as a tappable chip. Exhibit ids are not a Chamber's own raw ids (a note with id 36 is \`note-36\`), so never assemble a token yourself: copy the \`token\` from Congress's search_exhibits/resolve_exhibits results, or pass a Chamber's raw id to get_exhibit_chip. Inside a Markdown table, escape the token's pipe as \`\\|\`.`;

// Every run - chat or a Chamber's remote run - gets the same frame: the base
// identity, the current time, and the owner's own context prompt. The
// caller's part (a chat message, a Chamber's prompt) comes last.
export function buildPrompt(settings: Pick<AiSettings, "contextPrompt">, body: string, now = new Date()): string {
  const parts = [`${BASE_IDENTITY_PROMPT}\n\nCurrent server time: ${now.toISOString()}`];
  if (settings.contextPrompt.trim()) parts.push(`## Context\n${settings.contextPrompt.trim()}`);
  parts.push(body);
  return parts.join("\n\n");
}

export interface ReferencedExhibit {
  token: string;
  label: string;
  // null when the owning Chamber couldn't resolve it.
  name: string | null;
  url: string | null;
  state: "ok" | "deleted" | "unavailable";
}

export function chatPromptBody(message: string, referenced: ReferencedExhibit[] = []): string {
  const parts = [`## Message from the owner\n${message}`];
  if (referenced.length > 0) {
    const lines = referenced.map((r) => {
      if (r.state === "deleted") return `- ${r.token} ("${r.label}") - deleted`;
      if (r.state === "unavailable") return `- ${r.token} ("${r.label}") - its Chamber is unreachable right now`;
      return `- ${r.token} - "${r.name}" (${r.url})`;
    });
    parts.push(`## Exhibits referenced\n${lines.join("\n")}`);
  }
  return parts.join("\n\n");
}
