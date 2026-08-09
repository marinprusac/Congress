import { useNavigate } from "react-router-dom";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useQuery } from "@tanstack/react-query";
import { buildExhibitToken, parseExhibitToken } from "@congress/shared-types";
import type { CapitolExhibitResolveResult } from "@congress/shared-types";
import { ExhibitChip } from "@congress/exhibit-ui";
import { toMarkdownWithExhibitLinks, decodeExhibitLinkHref, extractExhibitTokens } from "@/lib/wikilinks";
import { getChamberIcon } from "./ChamberIcon";

interface NoteMarkdownProps {
  body: string;
}

async function resolveExhibitTokens(tokens: string[]): Promise<CapitolExhibitResolveResult[]> {
  if (tokens.length === 0) return [];
  const refs = tokens
    .map((token) => parseExhibitToken(token))
    .filter((t): t is NonNullable<typeof t> => t !== null);
  const res = await fetch("/capitol/exhibits/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refs }),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { results: CapitolExhibitResolveResult[] };
  return data.results;
}

export function NoteMarkdown({ body }: NoteMarkdownProps) {
  const navigate = useNavigate();
  const transformed = toMarkdownWithExhibitLinks(body);
  const tokens = extractExhibitTokens(body);

  const { data: results } = useQuery({
    queryKey: ["exhibits-resolve", tokens],
    queryFn: () => resolveExhibitTokens(tokens),
    enabled: tokens.length > 0,
  });

  const resultsByToken = new Map<string, CapitolExhibitResolveResult>();
  for (const result of results ?? []) {
    resultsByToken.set(buildExhibitToken({ chamber: result.chamber, id: result.id }), result);
  }

  return (
    <div className="note-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // react-markdown's default urlTransform strips any URL scheme outside
        // http/https/mailto/tel as an XSS precaution - our internal
        // exhibit-ref: marker needs an explicit pass-through, everything
        // else keeps the default rule.
        urlTransform={(url) => (url.startsWith("exhibit-ref:") ? url : defaultUrlTransform(url))}
        components={{
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
                  onNavigate={(r) => navigate(r.url)}
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
