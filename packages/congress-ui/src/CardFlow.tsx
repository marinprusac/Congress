import type { ReactNode, MouseEventHandler, FocusEventHandler } from "react";
import { Link } from "react-router-dom";

// The shared replacement for the old full-width row-list idiom (still in
// ListStates.tsx, being phased out chamber-by-chamber). Layout mechanics are
// lifted from chamber-notes's own .note-card/.notes-flow (flex-wrap so each
// card sizes to its own content instead of being stretched to a shared grid
// track) - but without that component's paper/dog-ear visual, which is a
// Notes-specific metaphor, not a generic system look.
export interface CompactCardProps {
  title: ReactNode;
  // e.g. "3 exercises · 4,200 kg" - secondary line under the title.
  subtitle?: ReactNode;
  // Trailing, right-aligned content - a date, a count, a badge.
  detail?: ReactNode;
  // Renders as a <Link> when present.
  href?: string;
  onClick?: () => void;
  onMouseEnter?: MouseEventHandler;
  onFocus?: FocusEventHandler;
}

export function CompactCard({ title, subtitle, detail, href, onClick, onMouseEnter, onFocus }: CompactCardProps) {
  const content = (
    <>
      <span className="compact-card-title font-display text-lg text-ink">{title}</span>
      {subtitle && <p className="mt-1 text-sm text-slate">{subtitle}</p>}
      {detail && <p className="compact-card-detail mt-1 text-xs text-dust">{detail}</p>}
    </>
  );

  if (href) {
    return (
      <Link to={href} className="compact-card" onMouseEnter={onMouseEnter} onFocus={onFocus}>
        {content}
      </Link>
    );
  }

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      className="compact-card"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onFocus={onFocus}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {content}
    </div>
  );
}

export function CardFlow({ children }: { children: ReactNode }) {
  return <div className="compact-card-flow">{children}</div>;
}

// Card-shaped skeleton placeholders - ListLoadingState's bars are row-shaped
// (full-width, border-bottom) and read wrong inside a wrapping card flow.
export function CardFlowLoadingState() {
  return (
    <div className="compact-card-flow" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="compact-card compact-card-skeleton">
          <div className="list-skeleton-bar list-skeleton-title" />
          <div className="list-skeleton-bar list-skeleton-subtitle" />
        </div>
      ))}
    </div>
  );
}
