import { useNavigate } from "react-router-dom";
import { resolveChamberPath } from "@congress/congress-ui";

// Link handling for rendered chat Markdown: in-app paths and exhibit chips
// navigate inside the shell (same as the Home feed's exhibit cards).
export function useChatNavigation() {
  const navigate = useNavigate();
  return {
    onNavigatePath: (path: string) => navigate(path),
    onNavigateExhibit: (result: { chamber: string; url: string }) => navigate(resolveChamberPath(result.url, result.chamber, true)),
  };
}
