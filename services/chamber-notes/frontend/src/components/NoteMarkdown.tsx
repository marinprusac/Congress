import { useNavigate } from "react-router-dom";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { extractExhibitTokens, useResolvedExhibits, ExhibitChip, navigateToExhibit } from "@congress/exhibit-ui";
import { toMarkdownWithExhibitLinks, decodeExhibitLinkHref } from "@/lib/wikilinks";
import { getChamberIcon } from "./ChamberIcon";

interface NoteMarkdownProps {
  body: string;
  onDoubleClick?: () => void;
}

export function NoteMarkdown({ body, onDoubleClick }: NoteMarkdownProps) {
  const navigate = useNavigate();
  const transformed = toMarkdownWithExhibitLinks(body);
  const tokens = extractExhibitTokens(body);
  const { resultsByToken } = useResolvedExhibits(tokens);

  return (
    <div className="note-prose" onDoubleClick={onDoubleClick} title={onDoubleClick ? "Double-click to edit" : undefined}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // react-markdown's default urlTransform strips any URL scheme outside
        // http/https/mailto/tel as an XSS precaution - our internal
        // exhibit-ref: marker needs an explicit pass-through, everything
        // else keeps the default rule.
        urlTransform={(url) => (url.startsWith("exhibit-ref:") ? url : defaultUrlTransform(url))}
        components={{
          // A wide table has no reason to shrink its columns to fit a phone
          // screen - scrolling horizontally within its own bounds reads
          // better than either overflowing the page or squashing cells.
          table: ({ node: _node, ...props }) => (
            <div className="note-table-wrapper">
              <table {...props} />
            </div>
          ),
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
                  onNavigate={(r) => navigateToExhibit("notes", r, navigate)}
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
        }}
      >
        {transformed}
      </ReactMarkdown>
    </div>
  );
}
