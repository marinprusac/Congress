import type { ReactNode } from "react";
import type { CapitolExhibitResolveResult } from "@congress/shared-types";
import { ExhibitChip } from "./ExhibitChip.js";
import { useExhibitLinks } from "./useExhibitLinks.js";

interface LinksPanelProps {
  title: string;
  results: CapitolExhibitResolveResult[];
  emptyLabel: string;
  renderIcon?: (chamber: string) => ReactNode;
  onNavigate?: (result: Extract<CapitolExhibitResolveResult, { url: string }>) => void;
  className: string;
}

function LinksPanel({ title, results, emptyLabel, renderIcon, onNavigate, className }: LinksPanelProps) {
  return (
    <aside className={className}>
      <h3 className="mb-2 font-mono text-xs uppercase tracking-wide text-dust">
        {title} ({results.length})
      </h3>
      {results.length === 0 ? (
        <p className="font-mono text-sm text-dust">— {emptyLabel} —</p>
      ) : (
        <ul>
          {results.map((r) => (
            <li key={`${r.chamber}:${r.id}`} className="border-b border-dust py-2">
              <ExhibitChip
                result={r}
                renderIcon={renderIcon}
                onNavigate={onNavigate}
                className="exhibit-chip font-mono text-sm"
              />
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

interface ExhibitLinksLayoutProps {
  exhibitId: string;
  emptyBacklinksLabel: string;
  emptyFrontlinksLabel: string;
  renderIcon?: (chamber: string) => ReactNode;
  onNavigate?: (result: Extract<CapitolExhibitResolveResult, { url: string }>) => void;
  children: ReactNode;
  className?: string;
}

// Flanks its children with two panels backed by Capitol's exhibit_refs graph
// (the same table Exhibit Sharing's closure BFS walks): exhibits referencing
// this one on the left, exhibits this one references on the right - on
// desktop, at the sides of the content; on mobile, stacked below it as a
// two-column row instead (see .exhibit-links-layout in styles.css).
export function ExhibitLinksLayout({
  exhibitId,
  emptyBacklinksLabel,
  emptyFrontlinksLabel,
  renderIcon,
  onNavigate,
  children,
  className,
}: ExhibitLinksLayoutProps) {
  const { backlinks, frontlinks } = useExhibitLinks(exhibitId);

  return (
    <div className={["exhibit-links-layout", className].filter(Boolean).join(" ")}>
      <LinksPanel
        title="Referenced by"
        results={backlinks}
        emptyLabel={emptyBacklinksLabel}
        renderIcon={renderIcon}
        onNavigate={onNavigate}
        className="exhibit-links-panel-back"
      />
      <div className="exhibit-links-main">{children}</div>
      <LinksPanel
        title="References"
        results={frontlinks}
        emptyLabel={emptyFrontlinksLabel}
        renderIcon={renderIcon}
        onNavigate={onNavigate}
        className="exhibit-links-panel-front"
      />
    </div>
  );
}
