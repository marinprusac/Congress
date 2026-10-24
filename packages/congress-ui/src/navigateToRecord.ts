import type { CapitolRecordResolveResult } from "@congress/shared-types";
import { getNavEngine } from "./navEngine.js";

// A resolved record's `url` is relative to its namespace ("e" for records),
// so the page is "/<namespace><url>", pushed onto the current tab's stack.
export function navigateToRecord(
  result: Extract<CapitolRecordResolveResult, { url: string }>,
  localNavigate: (path: string) => void
): void {
  const path = `/${result.chamber}${result.url}`;
  const engine = getNavEngine();
  if (engine) void engine.push(path);
  else localNavigate(path);
}
