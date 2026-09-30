import { useQuery } from "@tanstack/react-query";
import { StackLink } from "@congress/congress-ui";
import { fetchChat, fetchMessages, ReaderUnavailableError } from "@/views/whatsapp/api";
import { withDayBreaks } from "@/views/whatsapp/format";
import { MessageBubble } from "@/views/whatsapp/MessageBubble";
import "@/views/whatsapp/whatsapp.css";
import type { LiveProps } from "./index";

// The chat's newest messages, read live from the reader (read-only).
export function WhatsappChat({ sourceKey }: LiveProps) {
  const chat = useQuery({ queryKey: ["chat", sourceKey], queryFn: () => fetchChat(sourceKey) });
  const messages = useQuery({ queryKey: ["messages", sourceKey, "live"], queryFn: () => fetchMessages(sourceKey), refetchInterval: 30_000, retry: false });
  if (messages.isLoading) return <p className="font-mono text-sm text-dust">Loading —</p>;
  if (messages.isError) return <p className="font-mono text-sm text-alert">{messages.error instanceof ReaderUnavailableError ? "The WhatsApp reader isn't running." : "Failed to load messages."}</p>;
  const isGroup = chat.data?.isGroup ?? sourceKey.endsWith("@g.us");
  return (
    <section>
      <div className="wa-thread">
        {withDayBreaks(messages.data?.messages.slice(0, 30) ?? []).map(({ message, day }) => (
          <div key={message.id}>
            {day && <p className="wa-day">{day}</p>}
            <MessageBubble message={message} showSender={isGroup} highlighted={false} />
          </div>
        ))}
      </div>
      <StackLink to={`/whatsapp/c/${encodeURIComponent(sourceKey)}`} className="wa-more">
        Open the whole chat
      </StackLink>
      <p className="wa-readonly">Read-only · nothing here is sent to WhatsApp</p>
    </section>
  );
}
