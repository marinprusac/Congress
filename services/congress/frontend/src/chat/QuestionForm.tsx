import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { answerSchemaFor, type AskAnswerValue, type AskField } from "@congress/shared-types";
import { ExhibitInlineField, getChamberIcon, showToast } from "@congress/congress-ui";
import { AskAnswerError, aiAsksQueryKey, aiThreadQueryKey, answerAsk } from "@/lib/aiApi";

type Values = Record<string, AskAnswerValue | undefined>;

export function initialValues(fields: AskField[]): Values {
  const values: Values = {};
  for (const f of fields) {
    if (f.type === "exhibit") values[f.key] = "";
    else if (f.type === "multichoice") values[f.key] = f.default ?? [];
    else values[f.key] = f.default ?? (f.type === "boolean" ? undefined : "");
  }
  return values;
}

// Client-side check with the server's own schema, as field -> message.
function validate(fields: AskField[], values: Values): Record<string, string> {
  const cleaned: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.key];
    cleaned[f.key] = f.type === "number" && typeof v === "string" ? (v.trim() === "" ? null : Number(v)) : f.type === "exhibit" && typeof v === "string" ? v.trim() : v;
  }
  const result = answerSchemaFor(fields).safeParse(cleaned);
  if (result.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "");
    const field = fields.find((f) => f.key === key);
    errors[key] ??= issue.message === "Required" || issue.message.startsWith("Expected") || issue.message.startsWith("Invalid") ? (field?.type === "boolean" ? "Pick one" : "Required") : issue.message;
  }
  return errors;
}

function submitValues(fields: AskField[], values: Values): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.key];
    out[f.key] = f.type === "number" && typeof v === "string" ? (v.trim() === "" ? null : Number(v)) : typeof v === "string" ? v.trim() : (v ?? null);
  }
  return out;
}

function FieldInput({ field, value, onChange, disabled }: { field: AskField; value: AskAnswerValue | undefined; onChange: (v: AskAnswerValue) => void; disabled: boolean }) {
  const id = `ask-${field.key}`;
  switch (field.type) {
    case "text":
      return <input id={id} className="ask-input" value={String(value ?? "")} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} disabled={disabled} maxLength={500} />;
    case "longtext":
      return <textarea id={id} className="ask-input ask-textarea" value={String(value ?? "")} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} disabled={disabled} rows={3} maxLength={4000} />;
    case "number":
      return (
        <div className="ask-number">
          <input
            id={id}
            className="ask-input"
            type="number"
            inputMode="decimal"
            value={value === null || value === undefined ? "" : String(value)}
            min={field.min}
            max={field.max}
            step={field.step ?? "any"}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          />
          {field.unit ? <span className="ask-unit">{field.unit}</span> : null}
        </div>
      );
    case "boolean":
      return (
        <div className="ask-segment" role="radiogroup" aria-labelledby={`${id}-label`}>
          {[
            [true, "Yes"],
            [false, "No"],
          ].map(([v, label]) => (
            <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={`ask-chip${value === v ? " selected" : ""}`} onClick={() => onChange(v as boolean)} disabled={disabled}>
              {label as string}
            </button>
          ))}
        </div>
      );
    case "choice":
      return (
        <div className="ask-chips" role="radiogroup" aria-labelledby={`${id}-label`}>
          {field.options.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={`ask-chip${value === o.value ? " selected" : ""}`} onClick={() => onChange(o.value)} disabled={disabled}>
              {o.label}
            </button>
          ))}
        </div>
      );
    case "multichoice": {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="ask-chips" role="group" aria-labelledby={`${id}-label`}>
          {field.options.map((o) => {
            const on = selected.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                className={`ask-chip${on ? " selected" : ""}`}
                onClick={() => onChange(on ? selected.filter((v) => v !== o.value) : [...selected, o.value])}
                disabled={disabled}
              >
                {on ? "✓ " : ""}
                {o.label}
              </button>
            );
          })}
        </div>
      );
    }
    case "date":
      return <input id={id} className="ask-input" type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} disabled={disabled} />;
    case "datetime":
      return <input id={id} className="ask-input" type="datetime-local" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} disabled={disabled} />;
    case "exhibit":
      return (
        <ExhibitInlineField
          value={String(value ?? "")}
          onChange={(v) => onChange(v)}
          readOnly={disabled}
          placeholder="Type @ to pick"
          className="ask-input ask-exhibit"
          renderIcon={(chamber) => getChamberIcon(chamber)}
        />
      );
  }
}

export function QuestionForm({ messageId, threadId, fields, submitLabel }: { messageId: number; threadId: number; fields: AskField[]; submitLabel: string | null }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Values>(() => initialValues(fields));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);

  const submit = async () => {
    const found = validate(fields, values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSending(true);
    try {
      await answerAsk(messageId, submitValues(fields, values));
      void queryClient.invalidateQueries({ queryKey: aiThreadQueryKey(threadId) });
      void queryClient.invalidateQueries({ queryKey: aiAsksQueryKey });
    } catch (err) {
      if (err instanceof AskAnswerError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      else showToast(err instanceof Error ? err.message : "Couldn't send the answer", "error");
      setSending(false);
    }
  };

  return (
    <form
      className="ask-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
    >
      {fields.map((f) => (
        <div key={f.key} className={`ask-field${errors[f.key] ? " ask-field--error" : ""}`}>
          <label id={`ask-${f.key}-label`} htmlFor={`ask-${f.key}`} className="ask-label">
            {f.label}
            {f.required ? null : <span className="ask-optional"> optional</span>}
          </label>
          {f.help ? <p className="ask-help">{f.help}</p> : null}
          <FieldInput field={f} value={values[f.key]} onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))} disabled={sending} />
          {errors[f.key] ? (
            <p className="ask-error" role="alert">
              {errors[f.key]}
            </p>
          ) : null}
        </div>
      ))}
      <button type="submit" className="ask-submit" disabled={sending}>
        {sending ? "Sending —" : (submitLabel ?? "Send answer")}
      </button>
    </form>
  );
}

// A one-field boolean/choice question can be answered with a single tap.
export function isOneTap(fields: AskField[]): boolean {
  const f = fields[0];
  return fields.length === 1 && !!f && (f.type === "boolean" || f.type === "choice");
}

export function OneTapAnswer({ messageId, threadId, field }: { messageId: number; threadId: number; field: AskField }) {
  const queryClient = useQueryClient();
  const [sending, setSending] = useState<string | null>(null);
  const options: { value: AskAnswerValue; label: string }[] =
    field.type === "boolean"
      ? [
          { value: true, label: "Yes" },
          { value: false, label: "No" },
        ]
      : field.type === "choice"
        ? field.options
        : [];
  return (
    <div className="ask-chips">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={`ask-chip${sending === String(o.value) ? " selected" : ""}`}
          disabled={sending !== null}
          onClick={async () => {
            setSending(String(o.value));
            try {
              await answerAsk(messageId, { [field.key]: o.value });
              void queryClient.invalidateQueries({ queryKey: aiAsksQueryKey });
              void queryClient.invalidateQueries({ queryKey: aiThreadQueryKey(threadId) });
            } catch (err) {
              showToast(err instanceof Error ? err.message : "Couldn't send the answer", "error");
              setSending(null);
            }
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
