// Pure display helpers for the chat (tested in chatFormat.test.ts).

// The CLI's own built-in helpers, named for what they mean to the owner.
const BUILTIN_TOOL_LABELS: Record<string, string> = { ToolSearch: "Load tools" };

// "mcp__notes__create_note" -> { chamber: "notes", label: "Create note" }
export function toolLabel(toolName: string): { chamber: string | null; label: string } {
  const builtin = BUILTIN_TOOL_LABELS[toolName];
  if (builtin) return { chamber: null, label: builtin };
  const match = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(toolName);
  const chamber = match?.[1] ?? null;
  const action = (match?.[2] ?? toolName).replace(/[_.-]+/g, " ").trim();
  return { chamber, label: action.charAt(0).toUpperCase() + action.slice(1) };
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function dayLabel(date: Date, now = new Date()): string {
  const diff = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff > 1 && diff < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

export function timeLabel(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

// Compact stamp for the thread list.
export function listStamp(date: Date, now = new Date()): string {
  const ms = now.getTime() - date.getTime();
  if (ms < 60_000) return "now";
  if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)}m`;
  const diff = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (diff === 0) return timeLabel(date);
  if (diff === 1) return "Yesterday";
  if (diff < 7) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function durationLabel(ms: number | null): string | null {
  if (ms === null) return null;
  if (ms < 1000) return "<1s";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

const GROUP_GAP_MS = 5 * 60_000;

// Where to draw day separators and per-group timestamps.
export function layoutMarkers<T extends { role: string; createdAt: string }>(
  messages: T[]
): { message: T; day: string | null; stamp: boolean }[] {
  const now = new Date();
  return messages.map((message, i) => {
    const prev = messages[i - 1];
    const at = new Date(message.createdAt);
    const prevAt = prev ? new Date(prev.createdAt) : null;
    const newDay = !prevAt || startOfDay(prevAt) !== startOfDay(at);
    const stamp = newDay || !prev || prev.role !== message.role || at.getTime() - (prevAt?.getTime() ?? 0) > GROUP_GAP_MS;
    return { message, day: newDay ? dayLabel(at, now) : null, stamp };
  });
}

export function stringifyToolValue(value: unknown, max = 4000): string {
  let text: string;
  if (typeof value === "string") text = value;
  else if (Array.isArray(value) && value.every((b) => b && typeof b === "object" && "text" in b)) {
    text = value.map((b) => String((b as { text: unknown }).text)).join("\n");
  } else text = JSON.stringify(value, null, 2) ?? "";
  try {
    // Tool outputs are often JSON inside text; pretty-print when possible.
    text = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // Not JSON.
  }
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}
