import { useMemo } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CapitolExhibitResolveResult } from "@congress/shared-types";
import { extractExhibitTokens } from "./textSegments.js";
import { useResolvedExhibits } from "./useResolvedExhibits.js";
import { ExhibitChip } from "./ExhibitChip.js";
import { getChamberIcon } from "./ChamberMarks.js";
import { toMarkdownWithExhibitLinks, decodeExhibitLinkHref } from "./wikilinks.js";

interface ExhibitMarkdownProps {
  body: string;
  onNavigate?: (result: Extract<CapitolExhibitResolveResult, { url: string }>) => void;
  // Called with how far through the rendered text (0 = start, 1 = end) the
  // double-click landed, so the caller can place the editor's caret roughly
  // where the reader was looking instead of always at the top.
  onDoubleClick?: (fraction: number) => void;
}

// Range.toString() of everything from the start of the container up to the
// clicked point gives the rendered plain-text length before the click -
// dividing by the container's total text length turns that into a
// resolution-independent fraction. This is only ever "roughly" right
// against the raw markdown source (bold/links/wikilinks change how many
// source characters a given amount of rendered text costs), which is all
// double-click-to-edit needs.
function estimateTextFraction(container: HTMLElement, x: number, y: number): number {
  const doc = container.ownerDocument;
  const docWithCaret = doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };

  let range: Range | null = null;
  if (docWithCaret.caretRangeFromPoint) {
    range = docWithCaret.caretRangeFromPoint(x, y);
  } else if (docWithCaret.caretPositionFromPoint) {
    const pos = docWithCaret.caretPositionFromPoint(x, y);
    if (pos) {
      range = doc.createRange();
      range.setStart(pos.offsetNode, pos.offset);
    }
  }
  if (!range || !container.contains(range.startContainer)) return 0;

  const measured = doc.createRange();
  measured.selectNodeContents(container);
  measured.setEnd(range.startContainer, range.startOffset);
  const before = measured.toString().length;

  const total = container.textContent?.length ?? 0;
  return total === 0 ? 0 : Math.min(1, Math.max(0, before / total));
}

// Renders a Chamber's Markdown body (Notes) through react-markdown,
// resolving `[[exhibit:...]]` tokens into <ExhibitChip>s inline. Chambers
// whose content is plain text, not Markdown (e.g. Calendar's event
// description), use ExhibitAnnotatedText instead.
// Stable across every render - doesn't reference any prop/state, so it lives
// outside the memoized `components` object below rather than inside it.
function TableWrapper({ node: _node, ...props }: React.ComponentPropsWithoutRef<"table"> & { node?: unknown }) {
  return (
    <div className="note-table-wrapper">
      <table {...props} />
    </div>
  );
}

export function ExhibitMarkdown({ body, onNavigate, onDoubleClick }: ExhibitMarkdownProps) {
  // Both are full parses of the body (a regex pass, and react-markdown's own
  // remark pipeline below) - memoized on `body` so a re-render triggered by
  // something else entirely (e.g. a resolve settling, or a new onDoubleClick
  // closure from the caller) doesn't redo either.
  const transformed = useMemo(() => toMarkdownWithExhibitLinks(body), [body]);
  const tokens = useMemo(() => extractExhibitTokens(body), [body]);
  const { resultsByToken } = useResolvedExhibits(tokens);

  // Recreated only when what it actually reads changes - passing a fresh
  // object (and fresh `a`/`table` renderers) to react-markdown on every
  // render defeats its own internal memoization and forces the whole
  // parse -> transform -> render pipeline to redo the render step.
  const components: Components = useMemo(
    () => ({
      // A wide table has no reason to shrink its columns to fit a phone
      // screen - scrolling horizontally within its own bounds reads better
      // than either overflowing the page or squashing cells.
      table: TableWrapper,
      a: ({ href, children, node: _node, ...props }) => {
        const token = href ? decodeExhibitLinkHref(href) : null;
        if (token) {
          const result = resultsByToken.get(token);
          const fallbackLabel = typeof children === "string" ? children : undefined;
          if (!result) {
            return <span className="exhibit-chip-loading">{fallbackLabel ?? token}</span>;
          }
          return (
            <ExhibitChip
              result={result}
              fallbackLabel={fallbackLabel}
              renderIcon={(chamber) => getChamberIcon(chamber)}
              onNavigate={onNavigate}
              className="exhibit-chip"
            />
          );
        }
        return (
          <a {...props} href={href} target="_blank" rel="noopener noreferrer" className="note-link">
            {children}
          </a>
        );
      },
    }),
    [resultsByToken, onNavigate]
  );

  return (
    <div
      className="note-prose"
      onDoubleClick={(e) => onDoubleClick?.(estimateTextFraction(e.currentTarget, e.clientX, e.clientY))}
      title={onDoubleClick ? "Double-click to edit" : undefined}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // react-markdown's default urlTransform strips any URL scheme outside
        // http/https/mailto/tel as an XSS precaution - our internal
        // exhibit-ref: marker needs an explicit pass-through, everything
        // else keeps the default rule.
        urlTransform={(url) => (url.startsWith("exhibit-ref:") ? url : defaultUrlTransform(url))}
        components={components}
      >
        {transformed}
      </ReactMarkdown>
    </div>
  );
}
