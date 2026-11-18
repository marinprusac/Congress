import { lazy, Suspense, type ReactNode } from "react";
import { parseChatMap } from "./chatMap";

const ChatMap = lazy(() => import("./ChatMap"));

// Fenced code blocks that render as more than code in chat. A ```map block is drawn as a map;
// until its JSON is complete (streaming) or when it's invalid, it falls back to plain code.
export function renderChatBlock(lang: string, code: string, streaming: boolean): ReactNode | null {
  if (lang !== "map") return null;
  const spec = parseChatMap(code);
  if (!spec) return streaming ? <p className="chat-map-loading">Drawing the map —</p> : null;
  return (
    <Suspense fallback={<p className="chat-map-loading">Loading the map —</p>}>
      <ChatMap spec={spec} />
    </Suspense>
  );
}
