import { useCallback, useEffect, useRef, useState } from "react";
import { AI_MESSAGE_MAX_LENGTH } from "@congress/shared-types";
import { ExhibitFieldEditor, getChamberIcon } from "@congress/congress-ui";
import { setComposing } from "./useVisualViewport";

const DRAFT_PREFIX = "congress.chat.draft.";

function readDraft(key: string): string {
  try {
    return localStorage.getItem(DRAFT_PREFIX + key) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(DRAFT_PREFIX + key, value);
    else localStorage.removeItem(DRAFT_PREFIX + key);
  } catch {
    // Storage unavailable; the draft just isn't kept.
  }
}

// Desktop-style keyboards send on Enter; touch keyboards keep Return as newline.
function sendsOnEnter(): boolean {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

interface ComposerProps {
  draftKey: string;
  // Returns false when the send didn't go out (the draft is then kept).
  onSend: (text: string) => Promise<boolean> | boolean;
  running: boolean;
  onStop?: () => void;
  stopping?: boolean;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}

export function Composer({ draftKey, onSend, running, onStop, stopping, disabled, placeholder = "Message — @ to reference", autoFocus }: ComposerProps) {
  const [text, setText] = useState(() => readDraft(draftKey));
  const [sending, setSending] = useState(false);
  const textRef = useRef(text);
  textRef.current = text;

  // Switching threads swaps in that thread's draft.
  useEffect(() => {
    setText(readDraft(draftKey));
  }, [draftKey]);

  useEffect(() => () => setComposing(false), []);

  const update = (value: string) => {
    setText(value);
    writeDraft(draftKey, value);
  };

  const trimmed = text.trim();
  const tooLong = trimmed.length > AI_MESSAGE_MAX_LENGTH;
  const canSend = Boolean(trimmed) && !tooLong && !running && !sending && !disabled;

  const send = useCallback(async () => {
    const value = textRef.current.trim();
    if (!value || running || sending || disabled || value.length > AI_MESSAGE_MAX_LENGTH) return;
    setSending(true);
    setText("");
    writeDraft(draftKey, "");
    try {
      const ok = await onSend(value);
      if (!ok) {
        setText(value);
        writeDraft(draftKey, value);
      }
    } finally {
      setSending(false);
    }
  }, [draftKey, onSend, running, sending, disabled]);

  const sendRef = useRef(send);
  sendRef.current = send;

  return (
    <form
      className="chat-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      onFocus={() => setComposing(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setComposing(false);
      }}
    >
      <div className="chat-composer-field">
        <ExhibitFieldEditor
          value={text}
          onChange={update}
          placeholder={placeholder}
          className="chat-composer-editor"
          wrapperClassName="exhibit-field chat-composer-editor-wrap"
          renderIcon={(chamber) => getChamberIcon(chamber)}
          autoFocus={autoFocus}
          onSubmitKey={() => {
            if (!sendsOnEnter()) return false;
            void sendRef.current();
            return true;
          }}
        />
        {tooLong ? <p className="chat-composer-hint">Too long by {trimmed.length - AI_MESSAGE_MAX_LENGTH} characters.</p> : null}
      </div>
      {running ? (
        <button type="button" className="chat-send chat-send--stop" onClick={onStop} disabled={!onStop || stopping} aria-label="Stop reply">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="7" y="7" width="10" height="10" fill="currentColor" />
          </svg>
        </button>
      ) : (
        <button type="submit" className="chat-send" disabled={!canSend} aria-label="Send">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
          </svg>
        </button>
      )}
    </form>
  );
}
