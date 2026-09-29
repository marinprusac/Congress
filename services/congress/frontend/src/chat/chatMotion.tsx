import type { ComponentProps, MouseEvent } from "react";
import { Link } from "react-router-dom";
import { TransitionLink, type TransitionKind } from "@congress/congress-ui";

// On a phone the list and a thread are separate screens, so moving between
// them slides; on desktop they sit side by side and just swap.
function isPhone(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(max-width: 640px)").matches;
}

export function ChatLink({ transition = "push", ...props }: ComponentProps<typeof Link> & { transition?: TransitionKind }) {
  return isPhone() ? <TransitionLink transition={transition} {...props} /> : <Link {...props} />;
}

// onClick for a router link that should slide on a phone.
export function phoneTransitionClick(go: () => void) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (!isPhone() || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go();
  };
}
