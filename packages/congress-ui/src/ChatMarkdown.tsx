import { memo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CapitolExhibitResolveResult } from "@congress/shared-types";
import { ExhibitChip } from "./ExhibitChip.js";
import { getChamberIcon } from "./ChamberMarks.js";
import { useResolvedExhibits } from "./useResolvedExhibits.js";
import { EXHIBIT_HREF_PREFIX, exhibitTokensToLinks, trimPartialToken } from "./chatMarkdownText.js";

type ResolvedExhibit = Extract<CapitolExhibitResolveResult, { url: string }>;

interface ChatMarkdownProps {
  text: string;
  streaming?: boolean;
  onNavigateExhibit?: (result: ResolvedExhibit) => void;
  // Same-origin paths ("/notes/n/3") navigate in-app instead of reloading.
  onNavigatePath?: (path: string) => void;
  className?: string;
}

function ChatExhibitChip({ token, label, onNavigate }: { token: string; label: string; onNavigate?: (r: ResolvedExhibit) => void }) {
  const { resultsByToken } = useResolvedExhibits([token]);
  const result = resultsByToken.get(token);
  if (!result) return <span className="exhibit-chip chat-exhibit-chip" data-exhibit-state="loading">{label}</span>;
  return (
    <ExhibitChip
      result={result}
      fallbackLabel={label}
      className="exhibit-chip chat-exhibit-chip"
      renderIcon={(chamber) => getChamberIcon(chamber)}
      onNavigate={onNavigate}
    />
  );
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="chat-md-code">
      <button
        type="button"
        className="chat-md-code-copy"
        onClick={() => {
          const text = ref.current?.textContent ?? "";
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}

function urlTransform(url: string): string {
  return url.startsWith(EXHIBIT_HREF_PREFIX) ? url : defaultUrlTransform(url);
}

// Chat replies: GitHub-flavored Markdown with exhibit tokens as live chips.
export const ChatMarkdown = memo(function ChatMarkdown({ text, streaming, onNavigateExhibit, onNavigatePath, className }: ChatMarkdownProps) {
  const source = exhibitTokensToLinks(streaming ? trimPartialToken(text) : text);
  const components: Components = {
    a({ href, children }) {
      if (href?.startsWith(EXHIBIT_HREF_PREFIX)) {
        const label = typeof children === "string" ? children : Array.isArray(children) ? children.join("") : String(children ?? "");
        return <ChatExhibitChip token={decodeURIComponent(href)} label={label} onNavigate={onNavigateExhibit} />;
      }
      const internal = href?.startsWith("/") && !href.startsWith("//");
      return (
        <a
          href={href}
          target={internal ? undefined : "_blank"}
          rel={internal ? undefined : "noreferrer noopener"}
          onClick={(e) => {
            if (!internal || !onNavigatePath || !href) return;
            e.preventDefault();
            onNavigatePath(href);
          }}
        >
          {children}
        </a>
      );
    },
    pre({ children }) {
      return <CodeBlock>{children}</CodeBlock>;
    },
    table({ children }) {
      return (
        <div className="chat-md-table">
          <table>{children}</table>
        </div>
      );
    },
  };
  return (
    <div className={`chat-md${className ? ` ${className}` : ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={urlTransform} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
});
