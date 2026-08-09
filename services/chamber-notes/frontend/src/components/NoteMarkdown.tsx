import { useNavigate } from "react-router-dom";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { toMarkdownWithWikiLinks, WIKILINK_SCHEME } from "@/lib/wikilinks";
import { cn } from "@/lib/utils";

interface NoteMarkdownProps {
  body: string;
  resolveTitle: (title: string) => number | undefined;
}

export function NoteMarkdown({ body, resolveTitle }: NoteMarkdownProps) {
  const navigate = useNavigate();
  const transformed = toMarkdownWithWikiLinks(body);

  return (
    <div className="note-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // react-markdown's default urlTransform strips any URL scheme outside
        // http/https/mailto/tel as an XSS precaution - our internal `wikilink:`
        // scheme needs an explicit pass-through, everything else keeps the default rule.
        urlTransform={(url) => (url.startsWith(WIKILINK_SCHEME) ? url : defaultUrlTransform(url))}
        components={{
          a: ({ href, children, node: _node, ...props }) => {
            if (href?.startsWith(WIKILINK_SCHEME)) {
              const title = decodeURIComponent(href.slice(WIKILINK_SCHEME.length));
              const id = resolveTitle(title);
              return (
                <a
                  {...props}
                  href={id ? `/n/${id}` : `/new?title=${encodeURIComponent(title)}`}
                  className={cn(id ? "wikilink-resolved" : "wikilink-unresolved")}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(id ? `/n/${id}` : `/new?title=${encodeURIComponent(title)}`);
                  }}
                >
                  {children}
                </a>
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
