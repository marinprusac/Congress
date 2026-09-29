// Initials only - profile pictures would need extra WhatsApp queries.
export function Avatar({ name, group }: { name: string; group?: boolean }) {
  const letters = name.startsWith("+")
    ? "#"
    : name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => [...w][0]?.toUpperCase() ?? "")
        .join("");
  return (
    <span className={`wa-avatar ${group ? "wa-avatar-group" : ""}`} aria-hidden="true">
      {letters || "?"}
    </span>
  );
}
