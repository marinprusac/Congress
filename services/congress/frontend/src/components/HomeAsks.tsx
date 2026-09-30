import { useQuery, useQueryClient } from "@tanstack/react-query";
import { askQuestionPayloadSchema, type OpenAsk } from "@congress/shared-types";
import { ChatMarkdown, StackLink } from "@congress/congress-ui";
import { aiAsksQueryKey, aiThreadsQueryKey, fetchOpenAsks, markAiThreadRead } from "@/lib/aiApi";
import { OneTapAnswer, isOneTap } from "@/chat/QuestionForm";
import { useChatNavigation } from "@/chat/chatNav";
import { listStamp } from "@/chat/chatFormat";
import "@/chat/asks.css";

const KIND_LABEL = { message: "Message", question: "Question", proposal: "Proposal", builder_request: "Builder mode", type_publish: "Type change" } as const;

function HomeAsk({ ask }: { ask: OpenAsk }) {
  const nav = useChatNavigation();
  const queryClient = useQueryClient();
  const question = ask.kind === "question" ? askQuestionPayloadSchema.safeParse(ask.payload) : null;
  const oneTap = question?.success && isOneTap(question.data.fields) ? question.data.fields[0] : null;
  const href = `/chat/${ask.threadId}`;
  return (
    <li className={`home-ask ask-card ask-card--${ask.kind}`}>
      <header className="ask-card-head">
        <span className="ask-kind">{KIND_LABEL[ask.kind]}</span>
        <span className="chat-stamp">{listStamp(new Date(ask.createdAt))}</span>
      </header>
      {ask.title ? <h3 className="ask-title">{ask.title}</h3> : null}
      <ChatMarkdown text={ask.text} className="ask-body home-ask-body" {...nav} />
      <div className="home-ask-actions">
        {oneTap ? (
          <OneTapAnswer messageId={ask.messageId} threadId={ask.threadId} field={oneTap} />
        ) : (
          <StackLink to={href} className="ask-submit home-ask-open">
            {ask.kind === "question" ? "Answer" : ask.kind === "builder_request" ? "Decide" : ask.kind === "message" ? "Open" : "Review"}
          </StackLink>
        )}
        {ask.kind === "message" ? (
          <button
            type="button"
            className="chat-meta-action"
            onClick={async () => {
              await markAiThreadRead(ask.threadId);
              void queryClient.invalidateQueries({ queryKey: aiAsksQueryKey });
              void queryClient.invalidateQueries({ queryKey: aiThreadsQueryKey });
            }}
          >
            Dismiss
          </button>
        ) : oneTap ? (
          <StackLink to={href} className="chat-meta-action">
            Open chat
          </StackLink>
        ) : null}
      </div>
    </li>
  );
}

// "Congress asks": what the AI is waiting on or wants you to see, above the feed.
export function HomeAsks() {
  const asks = useQuery({ queryKey: aiAsksQueryKey, queryFn: fetchOpenAsks, refetchInterval: 60_000 });
  if (!asks.data?.length) return null;
  return (
    <section className="home-asks" aria-label="Congress asks">
      <h2 className="home-asks-heading">Congress asks</h2>
      <ul className="home-asks-list">
        {asks.data.map((ask) => (
          <HomeAsk key={ask.messageId} ask={ask} />
        ))}
      </ul>
    </section>
  );
}
