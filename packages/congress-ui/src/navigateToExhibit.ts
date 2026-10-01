import type { CapitolExhibitResolveResult } from "@congress/shared-types";
import { getNavEngine } from "./navEngine.js";

// A resolved exhibit's `url` is relative to its namespace ("e" for records),
// so the page is "/<namespace><url>", pushed onto the current tab's stack.
export function navigateToExhibit(
  result: Extract<CapitolExhibitResolveResult, { url: string }>,
  localNavigate: (path: string) => void
): void {
  const path = `/${result.chamber}${result.url}`;
  const engine = getNavEngine();
  if (engine) void engine.push(path);
  else localNavigate(path);
}
