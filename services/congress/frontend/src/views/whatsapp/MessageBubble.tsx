import { useState } from "react";
import { mediaUrl, type Message } from "@/views/whatsapp/api";
import { clockTime, formatBytes, formatDuration, senderLabel, typeLabel } from "@/views/whatsapp/format";

// Attachments load only when tapped: each view is a download through wa-reader.
function Media({ message }: { message: Message }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const media = message.media;
  if (!media) return null;
  const src = mediaUrl(message);
  const size = media.size ? ` · ${formatBytes(media.size)}` : "";
  const extra = media.seconds ? ` · ${formatDuration(media.seconds)}` : "";

  if (media.tooLarge) {
    return <p className="wa-media-note">{typeLabel(message.type)}{size} — too large to load here</p>;
  }
  if (message.type === "document") {
    return (
      <a href={src} className="wa-media-button" download={media.filename || undefined}>
        📄 {media.filename || "Document"}
        {size}
      </a>
    );
  }
  if (!open) {
    return (
      <button type="button" className="wa-media-button" onClick={() => setOpen(true)}>
        {typeLabel(message.type)}
        {extra}
        {size} — tap to load
      </button>
    );
  }
  if (failed) return <p className="wa-media-note">Couldn't load this (it may have expired on WhatsApp's servers).</p>;
  const onError = () => setFailed(true);
  switch (message.type) {
    case "image":
    case "sticker":
      return <img src={src} alt="" className="wa-media" onError={onError} />;
    case "video":
    case "gif":
      return <video src={src} controls playsInline autoPlay={message.type === "gif"} loop={message.type === "gif"} muted={message.type === "gif"} className="wa-media" onError={onError} />;
    case "audio":
    case "voice":
      return <audio src={src} controls autoPlay className="wa-audio" onError={onError} />;
  }
  return null;
}

export function MessageBubble({ message, showSender, highlighted }: { message: Message; showSender: boolean; highlighted: boolean }) {
  const m = message;
  const revoked = m.revokedAt !== null;
  return (
    <div id={`m-${m.id}`} className={`wa-row ${m.fromMe ? "wa-row-me" : ""}`}>
      <div className={`wa-bubble ${m.fromMe ? "wa-bubble-me" : ""} ${highlighted ? "wa-bubble-hit" : ""}`}>
        {showSender && !m.fromMe && <p className="wa-sender">{senderLabel(m)}</p>}
        {m.quoted && !revoked && (
          <div className="wa-quote">
            <p className="wa-sender">{m.quoted.senderJid || m.quoted.fromMe ? senderLabel(m.quoted) : "Earlier message"}</p>
            <p className="line-clamp-3">{m.quoted.text || typeLabel(m.quoted.type || "placeholder")}</p>
          </div>
        )}
        {revoked ? (
          <p className="wa-deleted">🚫 This message was deleted</p>
        ) : (
          <>
            <Media message={m} />
            {m.text && <p className="wa-text">{m.text}</p>}
            {!m.text && !m.media && <p className="wa-deleted">{typeLabel(m.type)}</p>}
          </>
        )}
        <p className="wa-meta">
          {m.editedAt !== null && !revoked && "edited · "}
          {clockTime(m.ts)}
        </p>
        {m.reactions.length > 0 && (
          <p className="wa-reactions" title={m.reactions.map((r) => `${r.emoji} ${r.senderName || "someone"}`).join(", ")}>
            {m.reactions.map((r) => r.emoji).join(" ")}
          </p>
        )}
      </div>
    </div>
  );
}
