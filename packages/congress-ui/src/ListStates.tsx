export function ListSearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      type="search"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mb-6 w-full border border-dust bg-parchment px-3 py-2 font-mono text-base text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
    />
  );
}

export function ListLoadingState() {
  return <div className="px-1 py-3 font-mono text-sm text-dust">Loading —</div>;
}

export function ListErrorState({ label }: { label: string }) {
  return <div className="px-1 py-3 font-mono text-sm text-alert">Failed to reach the {label} API.</div>;
}

export function ListEmptyState({ label, hasQuery }: { label: string; hasQuery: boolean }) {
  return (
    <div className="border-b border-dust px-1 py-3 font-mono text-sm text-dust">
      — No {label} {hasQuery ? "match your search" : "yet"} —
    </div>
  );
}
