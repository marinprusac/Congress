// Record titles always start with the type's label: "Work Session: 23 October".
export const titlePrefix = (label: string): string => `${label}: `;

export function stripTitlePrefix(label: string, title: string): string {
  const p = titlePrefix(label);
  if (title.startsWith(p)) return title.slice(p.length);
  return title === p.trimEnd() ? "" : title;
}

// Empty stays empty so an unnamed record still reads "Untitled ...".
export function withTitlePrefix(label: string, title: string): string {
  const rest = stripTitlePrefix(label, title.trim()).trim();
  return rest ? titlePrefix(label) + rest : "";
}
