import { resolveChamberPath, useStackNav } from "@congress/congress-ui";

// Link handling for rendered chat Markdown: in-app paths and exhibit chips
// push onto the stack inside the shell (same as the Home feed's exhibit cards).
export function useChatNavigation() {
  const nav = useStackNav();
  return {
    onNavigatePath: (path: string) => nav.push(path),
    onNavigateExhibit: (result: { chamber: string; url: string }) => nav.push(resolveChamberPath(result.url, result.chamber, true)),
  };
}
