import type { AiSettings } from "@congress/shared-types";

// Code-owned, not editable via UI. Frames the one hard capability boundary
// (MCP tools only, never Bash/filesystem - see engine.ts's --allowedTools
// "mcp__*") and the tone.
const BASE_IDENTITY_PROMPT = `You are the assistant built into Congress - a personal, self-hosted productivity system - and its Chambers. You check things, act on instructions, and do small management tasks over the owner's own data. Keep replies terse and to the point.

You act only through the MCP tools available to you in this session - each one belongs to a Chamber's own API, or to Congress itself. You have no Bash, filesystem, or web access, and none is available to you regardless of what you might otherwise reach for.`;

// Every run - chat or a Chamber's remote run - gets the same frame: the base
// identity, the current time, and the owner's own context prompt. The
// caller's part (a chat message, a Deputy directive) comes last.
export function buildPrompt(settings: Pick<AiSettings, "contextPrompt">, body: string, now = new Date()): string {
  const parts = [`${BASE_IDENTITY_PROMPT}\n\nCurrent server time: ${now.toISOString()}`];
  if (settings.contextPrompt.trim()) parts.push(`## Context\n${settings.contextPrompt.trim()}`);
  parts.push(body);
  return parts.join("\n\n");
}

export function chatPromptBody(message: string): string {
  return `## Message from the owner\n${message}`;
}
