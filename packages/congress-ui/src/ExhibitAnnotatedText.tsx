import type { ReactNode } from "react";
import { Fragment } from "react";
import type { CapitolExhibitResolveResult } from "@congress/shared-types";
import { parseExhibitToken } from "@congress/shared-types";
import { splitExhibitText, extractExhibitTokens } from "./textSegments.js";
import { useResolvedExhibits } from "./useResolvedExhibits.js";
import { ExhibitChip } from "./ExhibitChip.js";

interface ExhibitAnnotatedTextProps {
  text: string;
  renderIcon?: (chamber: string) => ReactNode;
  onNavigate?: (result: Extract<CapitolExhibitResolveResult, { url: string }>) => void;
  className?: string;
  // See useResolvedExhibits - defaults to Capitol's own-session resolve
  // endpoint; SharedViewPage passes the token-scoped one instead.
  resolveUrl?: string;
}

// For chambers whose content is plain text, not Markdown (e.g. Calendar's
// event description) - renders `[[exhibit:chamber:id|Label]]` spans as
// inline <ExhibitChip>s and leaves everything else as literal text. Notes
// doesn't use this: its body goes through a full react-markdown pipeline
// instead (see NoteMarkdown), which needs its own link-based approach.
export function ExhibitAnnotatedText({ text, renderIcon, onNavigate, className, resolveUrl }: ExhibitAnnotatedTextProps) {
  const tokens = extractExhibitTokens(text);
  const { resultsByToken, loading } = useResolvedExhibits(tokens, resolveUrl);
  const segments = splitExhibitText(text);

  return (
    <span className={className}>
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return <Fragment key={index}>{segment.value}</Fragment>;
        }
        const result = resultsByToken.get(segment.token);
        if (!result) {
          if (loading) return <Fragment key={index}>{segment.label}</Fragment>;
          const parsed = parseExhibitToken(segment.token);
          const placeholder: CapitolExhibitResolveResult = {
            id: parsed?.id ?? segment.token,
            chamber: parsed?.chamber ?? "",
            unavailable: true,
          };
          return (
            <ExhibitChip
              key={index}
              result={placeholder}
              fallbackLabel={segment.label}
              renderIcon={renderIcon}
              onNavigate={onNavigate}
              className="exhibit-chip"
            />
          );
        }
        return (
          <ExhibitChip
            key={index}
            result={result}
            fallbackLabel={segment.label}
            renderIcon={renderIcon}
            onNavigate={onNavigate}
            className="exhibit-chip"
          />
        );
      })}
    </span>
  );
}
