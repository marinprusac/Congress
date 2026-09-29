import { memo, useState } from "react";
import type { AiMessage } from "@congress/shared-types";
import { ChatMarkdown, StackLink, showToast } from "@congress/congress-ui";
import { StoredActivity } from "./RunActivity";
import { AskCard } from "./AskCards";
import { useChatNavigation } from "./chatNav";
import { timeLabel } from "./chatFormat";

export { useChatNavigation };

function copy(text: string) {
  void navigator.clipboard
    ?.writeText(text)
    .then(() => showToast("Copied"))
    .catch(() => showToast("Couldn't copy", "error"));
}

interface MessageItemProps {
  message: AiMessage;
  stamp: boolean;
  // The last reply in the thread, if it failed: offers Retry.
  onRetry?: () => void;
  retrying?: boolean;
}

function Stamp({ message, show }: { message: AiMessage; show: boolean }) {
  const [full, setFull] = useState(false);
  if (!show && !full) return null;
  const at = new Date(message.createdAt);
  return (
    <button type="button" className="chat-stamp" onClick={() => setFull((f) => !f)}>
      {full ? at.toLocaleString() : timeLabel(at)}
    </button>
  );
}

export const MessageItem = memo(function MessageItem({ message, stamp, onRetry, retrying }: MessageItemProps) {
  const nav = useChatNavigation();

  if (message.kind === "message" || message.kind === "question" || message.kind === "proposal") {
    return <AskCard message={message} />;
  }

  if (message.role === "user") {
    return (
      <div className="chat-msg chat-msg--user">
        <Stamp message={message} show={stamp} />
        {message.kind === "answer" || message.kind === "decision" ? <span className="chat-user-label">{message.kind === "answer" ? "Your answer" : "Your decision"}</span> : null}
        <div className="chat-user-bubble" onDoubleClick={() => copy(message.text)}>
          <ChatMarkdown text={message.text} {...nav} />
        </div>
      </div>
    );
  }

  if (message.role === "system" || message.kind === "notice") {
    return <p className="chat-notice">{message.text}</p>;
  }

  const retry = onRetry ? (
    <button type="button" className="chat-inline-action" onClick={onRetry} disabled={retrying}>
      {retrying ? "Retrying —" : "Retry"}
    </button>
  ) : null;

  if (message.status === "refused") {
    return (
      <div className="chat-msg chat-msg--assistant">
        <div className="chat-state chat-state--refused" role="status">
          <p>{message.text}</p>
          <div className="chat-state-actions">
            <StackLink to="/settings?from=ai" className="chat-inline-action">
              AI settings
            </StackLink>
            {retry}
          </div>
        </div>
      </div>
    );
  }

  if (message.status === "error") {
    return (
      <div className="chat-msg chat-msg--assistant">
        <div className="chat-state chat-state--error" role="alert">
          <p>{message.text}</p>
          {retry ? <div className="chat-state-actions">{retry}</div> : null}
        </div>
      </div>
    );
  }

  if (message.status === "cancelled") {
    return (
      <div className="chat-msg chat-msg--assistant">
        <p className="chat-stopped">
          Stopped{retry ? " · " : ""}
          {retry}
        </p>
      </div>
    );
  }

  return (
    <div className="chat-msg chat-msg--assistant">
      {message.run ? <StoredActivity runId={message.run.id} toolCallCount={message.run.toolCallCount} durationMs={message.run.durationMs} /> : null}
      <ChatMarkdown text={message.text} className="chat-reply" {...nav} />
      <div className="chat-reply-meta">
        <Stamp message={message} show={stamp} />
        <button type="button" className="chat-meta-action" onClick={() => copy(message.text)} aria-label="Copy reply">
          Copy
        </button>
      </div>
    </div>
  );
});
