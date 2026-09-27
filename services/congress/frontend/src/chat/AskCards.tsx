import { useState } from "react";
import "./asks.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  askMessagePayloadSchema,
  askProposalPayloadSchema,
  askQuestionPayloadSchema,
  type AiMessage,
  type AskField,
  type AskProposalPayload,
} from "@congress/shared-types";
import { ChatMarkdown, showToast } from "@congress/congress-ui";
import { aiAsksQueryKey, aiRunQueryKey, aiThreadQueryKey, decideAsk, fetchAiRun } from "@/lib/aiApi";
import { ActivityList } from "./RunActivity";
import { QuestionForm } from "./QuestionForm";
import { useChatNavigation } from "./chatNav";
import { durationLabel, stringifyToolValue, timeLabel } from "./chatFormat";

const KIND_LABEL = { message: "Message", question: "Question", proposal: "Proposal" } as const;

function WhySheet({ runId, onClose }: { runId: string; onClose: () => void }) {
  const run = useQuery({ queryKey: aiRunQueryKey(runId), queryFn: () => fetchAiRun(runId) });
  const r = run.data;
  return (
    <div className="confirm-sheet-backdrop" onClick={onClose}>
      <div className="confirm-sheet docked-sheet chat-sheet why-sheet" role="dialog" aria-modal="true" aria-label="Why am I seeing this" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-sheet-title">Why you're seeing this</p>
        {run.isLoading ? <p className="chat-loading">Loading —</p> : null}
        {run.isError ? <p className="chat-activity-note">The run's details are no longer available.</p> : null}
        {r ? (
          <>
            <dl className="why-facts">
              <dt>Started by</dt>
              <dd>{r.trigger === "owner" ? "Your message" : r.trigger === "answer" ? "Your answer" : r.trigger === "decision" ? "Your decision" : (r.trigger ?? r.kind)}</dd>
              <dt>When</dt>
              <dd>{new Date(r.startedAt).toLocaleString()}</dd>
              <dt>Model</dt>
              <dd>{r.model ?? "—"}</dd>
              <dt>Took</dt>
              <dd>
                {durationLabel(r.durationMs) ?? "—"}
                {r.costUsd != null ? ` · $${r.costUsd.toFixed(3)}` : ""}
              </dd>
            </dl>
            {r.verdict ? <pre className="why-verdict">{stringifyToolValue(r.verdict)}</pre> : null}
            {r.activity.length ? <ActivityList activity={r.activity} /> : <p className="chat-activity-note">No tools were used.</p>}
          </>
        ) : null}
        <button type="button" className="chat-sheet-item chat-sheet-item--cancel" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function CardShell({ message, title, children, status }: { message: AiMessage; title: string; children: React.ReactNode; status?: string | null }) {
  const [why, setWhy] = useState(false);
  const kind = message.kind as keyof typeof KIND_LABEL;
  return (
    <div className="chat-msg chat-msg--assistant">
      <article className={`ask-card ask-card--${kind}${message.askState && message.askState !== "open" ? " ask-card--closed" : ""}`}>
        <header className="ask-card-head">
          <span className="ask-kind">{KIND_LABEL[kind] ?? "Congress"}</span>
          {status ? <span className="ask-status">{status}</span> : null}
        </header>
        {title ? <h3 className="ask-title">{title}</h3> : null}
        {children}
        <footer className="ask-card-foot">
          <span className="chat-stamp">{timeLabel(new Date(message.createdAt))}</span>
          {message.runId ? (
            <button type="button" className="chat-meta-action" onClick={() => setWhy(true)}>
              Why?
            </button>
          ) : null}
        </footer>
      </article>
      {why && message.runId ? <WhySheet runId={message.runId} onClose={() => setWhy(false)} /> : null}
    </div>
  );
}

function MessageAsk({ message }: { message: AiMessage }) {
  const nav = useChatNavigation();
  const payload = askMessagePayloadSchema.safeParse(message.payload);
  const links = payload.success ? payload.data.links : [];
  return (
    <CardShell message={message} title={payload.success ? (payload.data.title ?? "") : ""}>
      <ChatMarkdown text={message.text} className="ask-body" {...nav} />
      {links.length ? <ChatMarkdown text={links.join(" ")} className="ask-links" {...nav} /> : null}
    </CardShell>
  );
}

function answerLine(field: AskField, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field.type === "boolean") return value ? "Yes" : "No";
  if (field.type === "choice") return field.options.find((o) => o.value === value)?.label ?? String(value);
  if (field.type === "multichoice" && Array.isArray(value)) return value.map((v) => field.options.find((o) => o.value === v)?.label ?? v).join(", ");
  if (field.type === "number" && field.unit) return `${value} ${field.unit}`;
  return String(value);
}

function QuestionAsk({ message }: { message: AiMessage }) {
  const nav = useChatNavigation();
  const parsed = askQuestionPayloadSchema.safeParse(message.payload);
  if (!parsed.success) return <p className="chat-notice">This question couldn't be shown.</p>;
  const { title, fields, submitLabel, answer } = parsed.data;
  const state = message.askState;
  const status = state === "answered" ? "Answered" : state === "expired" ? "Expired" : state === "withdrawn" ? "Withdrawn" : null;
  return (
    <CardShell message={message} title={title} status={status}>
      <ChatMarkdown text={message.text} className="ask-body" {...nav} />
      {state === "open" ? (
        <QuestionForm messageId={message.id} threadId={message.threadId} fields={fields} submitLabel={submitLabel} />
      ) : answer ? (
        <dl className="ask-answers">
          {fields.map((f) => (
            <div key={f.key}>
              <dt>{f.label}</dt>
              <dd>{f.type === "exhibit" && typeof answer[f.key] === "string" ? <ChatMarkdown text={String(answer[f.key])} {...nav} /> : answerLine(f, answer[f.key])}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </CardShell>
  );
}

function ProposalActions({ payload, showResults }: { payload: AskProposalPayload; showResults: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <ol className="ask-actions">
      {payload.actions.map((a, i) => {
        const result = showResults ? payload.results?.[i] : undefined;
        return (
          <li key={i} className="ask-action">
            <button type="button" className="ask-action-row" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
              <span className="ask-action-num">{i + 1}</span>
              <span className="ask-action-summary">{a.summary}</span>
              {result ? <span className={`chat-tool-status${result.ok ? "" : " chat-tool-status--error"}`}>{result.ok ? "✓" : "✕"}</span> : null}
            </button>
            {open === i ? (
              <div className="chat-tool-detail">
                <p className="chat-tool-detail-label">
                  {a.server} · {a.tool}
                </p>
                <pre>{stringifyToolValue(a.args)}</pre>
                {result && !result.ok ? (
                  <>
                    <p className="chat-tool-detail-label">Error</p>
                    <pre>{result.error}</pre>
                  </>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function ProposalAsk({ message }: { message: AiMessage }) {
  const nav = useChatNavigation();
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = askProposalPayloadSchema.safeParse(message.payload);
  if (!parsed.success) return <p className="chat-notice">This proposal couldn't be shown.</p>;
  const payload = parsed.data;
  const state = message.askState;
  const status =
    state === "approved" ? "Running —" : state === "executed" ? "Done" : state === "failed" ? "Failed" : state === "rejected" ? "Rejected" : state === "withdrawn" ? "Withdrawn" : null;

  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      await decideAsk(message.id, approve, approve ? undefined : note.trim() || undefined);
      void queryClient.invalidateQueries({ queryKey: aiThreadQueryKey(message.threadId) });
      void queryClient.invalidateQueries({ queryKey: aiAsksQueryKey });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't send your decision", "error");
      setBusy(false);
    }
  };

  return (
    <CardShell message={message} title={payload.title} status={status}>
      <ChatMarkdown text={message.text} className="ask-body" {...nav} />
      <p className="ask-actions-label">{payload.actions.length === 1 ? "The change" : `${payload.actions.length} changes, in order`}</p>
      <ProposalActions payload={payload} showResults={state === "executed" || state === "failed"} />
      {state === "rejected" && payload.note ? <p className="ask-note">“{payload.note}”</p> : null}
      {state === "open" ? (
        rejecting ? (
          <div className="ask-reject">
            <textarea className="ask-input ask-textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should change? (optional)" maxLength={1000} autoFocus />
            <div className="ask-buttons">
              <button type="button" className="ask-secondary" onClick={() => setRejecting(false)} disabled={busy}>
                Back
              </button>
              <button type="button" className="ask-danger" onClick={() => void decide(false)} disabled={busy}>
                Reject
              </button>
            </div>
          </div>
        ) : (
          <div className="ask-buttons">
            <button type="button" className="ask-secondary" onClick={() => setRejecting(true)} disabled={busy}>
              Reject
            </button>
            <button type="button" className="ask-submit" onClick={() => void decide(true)} disabled={busy}>
              {busy ? "Approving —" : "Approve"}
            </button>
          </div>
        )
      ) : null}
    </CardShell>
  );
}

export function AskCard({ message }: { message: AiMessage }) {
  if (message.kind === "question") return <QuestionAsk message={message} />;
  if (message.kind === "proposal") return <ProposalAsk message={message} />;
  return <MessageAsk message={message} />;
}
