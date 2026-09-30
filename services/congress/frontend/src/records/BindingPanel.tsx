import type { RecordDto } from "@congress/shared-types";

// What a bound record's source says: why it's read-only, a push that hasn't
// landed, and the source values no field holds (read live).

type Binding = NonNullable<RecordDto["binding"]>;

export function BindingNotice({ binding }: { binding: Binding }) {
  const p = binding.pending;
  return (
    <>
      {binding.lockReason && <p className="mb-4 font-mono text-xs text-slate">{binding.lockReason}.</p>}
      {p && (
        <p className={`mb-4 font-mono text-xs ${p.failed ? "text-alert" : "text-slate"}`}>
          {p.failed ? `Couldn't save to ${binding.label}: ${p.error ?? "refused"}` : `Saving to ${binding.label}${p.error ? ` (retrying: ${p.error})` : " —"}`}
        </p>
      )}
    </>
  );
}

const humanize = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const isUrl = (v: unknown): v is string => typeof v === "string" && /^https:\/\//.test(v);
const isColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v);

export function LiveValues({ binding }: { binding: Binding }) {
  const entries = Object.entries(binding.live).filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && v.length === 0));
  if (entries.length === 0) return null;
  const links = entries.filter(([, v]) => isUrl(v));
  // Labels (e.g. a calendar's name) already show where their field is.
  const rest = entries.filter(([k, v]) => !isUrl(v) && !isColor(v) && !/Label$/.test(k));
  const color = entries.find(([, v]) => isColor(v))?.[1] as string | undefined;
  return (
    <section className="mb-6 min-w-0 space-y-2 border-t border-dust pt-4">
      <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-wide text-dust">
        {color && <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />}
        From {binding.label}
      </h2>
      {rest.map(([key, v]) => (
        <div key={key} className="min-w-0">
          <p className="font-mono text-xs text-dust">{humanize(key)}</p>
          {Array.isArray(v) ? (
            <ul className="space-y-0.5">
              {v.map((item) => (
                <li key={item} className="break-all font-mono text-sm text-ink">
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="break-words font-mono text-sm text-ink">{typeof v === "boolean" ? (v ? "Yes" : "No") : String(v)}</p>
          )}
        </div>
      ))}
      {links.map(([key, v]) => (
        <a key={key} href={v as string} target="_blank" rel="noopener noreferrer" className="tap-target block font-mono text-sm text-accent hover:underline">
          Open in {binding.label} ↗
        </a>
      ))}
    </section>
  );
}
