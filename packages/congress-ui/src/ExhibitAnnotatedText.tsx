import type { ReactNode } from "react";
import { Fragment, useMemo } from "react";
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
}

// For chambers whose content is plain text, not Markdown (e.g. Calendar's
// event description) - renders `[[exhibit:chamber:id|Label]]` spans as
// inline <ExhibitChip>s and leaves everything else as literal text. Notes
// doesn't use this: its body goes through a full react-markdown pipeline
// instead (see NoteMarkdown), which needs its own link-based approach.
export function ExhibitAnnotatedText({ text, renderIcon, onNavigate, className }: ExhibitAnnotatedTextProps) {
  // Both are full regex passes over the body - memoized on `text` so a
  // re-render triggered by something else entirely (e.g. a sibling resolve
  // settling) doesn't re-parse the same string again.
  const tokens = useMemo(() => extractExhibitTokens(text), [text]);
  const segments = useMemo(() => splitExhibitText(text), [text]);
  const { resultsByToken, loading } = useResolvedExhibits(tokens);

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
