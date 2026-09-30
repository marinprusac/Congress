import { useEffect, useMemo, useRef, useState } from "react";

// Renders an HTML email in a sandboxed iframe: no scripts, no forms, and a
// CSP that blocks remote loads (tracking pixels) until the owner allows images.
export function buildEmailDocument(html: string, allowImages: boolean): string {
  const csp = allowImages
    ? "default-src 'none'; img-src https: data:; style-src 'unsafe-inline' https:; font-src https: data:"
    : "default-src 'none'; img-src data:; style-src 'unsafe-inline'";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>
html,body{margin:0;background:#fff;color:#1c1c1a}
body{padding:12px;font:15px/1.45 system-ui,-apple-system,sans-serif;overflow-wrap:anywhere}
img{max-width:100%!important;height:auto!important}
table{max-width:100%!important}
pre{white-space:pre-wrap}
</style></head><body>${html}</body></html>`;
}

export function hasRemoteImages(html: string): boolean {
  return /<img\b[^>]*\bsrc\s*=\s*["']?https?:/i.test(html) || /url\(\s*["']?https?:/i.test(html);
}

export function EmailHtml({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [allowImages, setAllowImages] = useState(false);
  const [height, setHeight] = useState(120);
  const doc = useMemo(() => buildEmailDocument(html, allowImages), [html, allowImages]);
  const remote = useMemo(() => hasRemoteImages(html), [html]);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let observer: ResizeObserver | undefined;
    const measure = () => {
      const root = frame.contentDocument?.documentElement;
      const body = frame.contentDocument?.body;
      if (!root || !body) return;
      // Fixed-width newsletters (600px tables) get scaled down to fit, like mail apps do.
      body.style.zoom = "";
      const ratio = frame.clientWidth / root.scrollWidth;
      if (ratio < 1) body.style.zoom = String(ratio);
      setHeight(Math.max(40, root.scrollHeight));
    };
    const onLoad = () => {
      measure();
      const body = frame.contentDocument?.body;
      if (body && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(measure);
        observer.observe(body);
      }
    };
    frame.addEventListener("load", onLoad);
    return () => {
      frame.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [doc]);

  return (
    <div className="mail-html">
      {remote && !allowImages && (
        <button type="button" onClick={() => setAllowImages(true)} className="mail-html-images tap-target">
          Remote images blocked · Load images
        </button>
      )}
      <iframe
        ref={ref}
        title="Email content"
        srcDoc={doc}
        // allow-same-origin only so the frame can be measured; scripts stay off.
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        style={{ height }}
      />
    </div>
  );
}
