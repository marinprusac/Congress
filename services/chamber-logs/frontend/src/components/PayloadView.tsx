// Renders an event's arbitrary JSON payload (any Chamber, any shape) as
// readable key/value text instead of a raw JSON string - used by
// EventSettingsDetailPage's history list. Deliberately generic (key-name
// heuristics only, e.g. a "*Ms" field reads as a duration) rather than
// per-Chamber-aware, since a payload can come from any publisher.

function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  // The trailing unit is dropped from the label since formatPrimitive below
  // already bakes it into the value ("$0.0234", "8.7s") - keeping both would
  // just repeat it ("Cost Usd: $0.0234").
  const last = words[words.length - 1];
  if (words.length > 1 && last && /^(ms|usd)$/i.test(last)) words.pop();
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function isIsoDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value);
}

function formatPrimitive(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (/usd$/i.test(key)) return `$${value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
    if (/ms$/i.test(key)) return formatDuration(value);
    return value.toLocaleString();
  }
  if (typeof value === "string") {
    if (isIsoDateString(value)) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleString();
    }
    return value;
  }
  return String(value);
}

// One-line collapsed preview: the first few primitive fields, skipping
// nested objects/arrays (those only show once expanded).
export function summarizePayload(payload: Record<string, unknown>): string {
  const parts = Object.entries(payload)
    .filter(([, v]) => v === null || typeof v !== "object")
    .slice(0, 4)
    .map(([k, v]) => `${humanizeKey(k)}: ${formatPrimitive(k, v)}`);
  return parts.length > 0 ? parts.join(" · ") : "— no details —";
}

export function PayloadView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) {
    return <span className="text-dust">—</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-dust">— empty —</span>;
    return (
      <ol className="space-y-2">
        {value.map((item, i) => (
          <li key={i} className={depth > 0 ? "border-l border-dust pl-3" : ""}>
            {item !== null && typeof item === "object" ? (
              <>
                <span className="font-mono text-xs uppercase tracking-wide text-dust">#{i + 1}</span>
                <div className="mt-1">
                  <PayloadView value={item} depth={depth + 1} />
                </div>
              </>
            ) : (
              <span className="text-ink">{formatPrimitive(String(i), item)}</span>
            )}
          </li>
        ))}
      </ol>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-dust">— empty —</span>;
    return (
      <dl className="space-y-2">
        {entries.map(([k, v]) => (
          <div key={k}>
            <dt className="font-mono text-xs uppercase tracking-wide text-dust">{humanizeKey(k)}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-ink">
              {v !== null && typeof v === "object" ? (
                <div className="mt-1 border-l border-dust pl-3">
                  <PayloadView value={v} depth={depth + 1} />
                </div>
              ) : (
                formatPrimitive(k, v)
              )}
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return <span className="text-ink">{formatPrimitive("", value)}</span>;
}
