import { useRef, type ReactNode } from "react";
import { useWidgetPullBridge } from "./useWidgetPullBridge.js";

export interface WidgetPreviewShellProps {
  label: string;
  addHref: string;
  addLabel?: string;
  isLoading: boolean;
  isError: boolean;
  errorLabel: string;
  isEmpty: boolean;
  emptyLabel: string;
  // The item list itself - each Chamber renders its own item shape (a plain
  // title link for Notes/Documents, a title + time subtitle for Calendar),
  // so this stays a passed-in tree rather than a generic item renderer.
  children?: ReactNode;
}

// The chrome shared by every Chamber's widget preview - it's embedded
// directly as Capitol's homepage widget for that Chamber (via an iframe at
// chamber.routes.widget), not visited on its own. Links use target="_top"
// so a click breaks out of the iframe and navigates Capitol's own tab,
// rather than routing inside the small embedded frame.
export function WidgetPreviewShell({
  label,
  addHref,
  addLabel = "+ New",
  isLoading,
  isError,
  errorLabel,
  isEmpty,
  emptyLabel,
  children,
}: WidgetPreviewShellProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useWidgetPullBridge(scrollRef);

  return (
    <div className="flex h-screen flex-col bg-parchment p-3 text-ink">
      <div className="mb-2 flex shrink-0 items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-dust">{label}</p>
        <a
          href={addHref}
          target="_top"
          className="font-mono text-[10px] uppercase tracking-wide text-accent hover:underline"
        >
          {addLabel}
        </a>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-none">
        {isLoading && <p className="font-mono text-xs text-dust">Loading —</p>}
        {isError && <p className="font-mono text-xs text-alert">{errorLabel}</p>}
        {!isLoading && !isError && isEmpty && <p className="font-mono text-xs text-dust">{emptyLabel}</p>}
        {!isLoading && !isError && !isEmpty && children}
      </div>
    </div>
  );
}
