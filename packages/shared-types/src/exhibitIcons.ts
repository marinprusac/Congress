// Icons a type can use: lucide icon names (kebab-case). The frontend maps each to its component.
export const EXHIBIT_ICONS = [
  "file", "file-text", "sticky-note", "notebook", "book", "book-open", "bookmark", "bookmark-check", "tag", "folder",
  "archive", "inbox", "mail", "message-square", "message-circle", "phone", "user", "users", "contact", "building",
  "home", "calendar", "calendar-days", "clock", "alarm-clock", "timer", "hourglass", "square-check", "list-checks", "list-todo",
  "clipboard-list", "target", "flag", "star", "heart", "lightbulb", "zap", "flame", "trophy", "award",
  "gift", "dumbbell", "activity", "heart-pulse", "bike", "footprints", "mountain", "map", "map-pin", "compass",
  "navigation", "globe", "plane", "car", "train-front", "bus", "ship", "utensils", "coffee", "apple",
  "wine", "shopping-cart", "shopping-bag", "credit-card", "wallet", "banknote", "receipt", "piggy-bank", "briefcase", "graduation-cap",
  "school", "laptop", "smartphone", "camera", "image", "film", "music", "headphones", "mic", "gamepad-2",
  "palette", "brush", "pencil", "pen-line", "scissors", "wrench", "hammer", "key", "lock", "shield",
  "bell", "link", "paperclip", "cloud", "sun", "moon", "umbrella", "leaf", "tree-pine", "flower",
  "paw-print", "dog", "cat", "baby", "shirt", "bed", "pill", "stethoscope", "syringe", "brain",
  "smile", "thermometer", "droplet", "battery", "plug", "cpu", "database", "code", "terminal", "bug",
  "rocket", "puzzle", "box", "package", "truck", "store", "ticket", "newspaper", "quote", "chart-line",
  "chart-bar", "chart-pie", "scale", "hash", "at-sign", "circle-dot", "sparkles", "wand-sparkles", "repeat", "history",
  "text", "languages", "flask-conical", "microscope", "calculator",
] as const;
export type ExhibitIconName = (typeof EXHIBIT_ICONS)[number];

// Names stored before icons were lucide names.
const LEGACY_ICONS: Record<string, ExhibitIconName> = {
  note: "sticky-note",
  task: "square-check",
  document: "file-text",
  person: "user",
  calendar: "calendar",
  mail: "mail",
  fitness: "dumbbell",
  map: "map-pin",
  chat: "message-square",
};

const KNOWN = new Set<string>(EXHIBIT_ICONS);

// Any stored icon string to a displayable icon name; unknown values become "file".
export function normalizeExhibitIcon(icon: string | null | undefined): ExhibitIconName {
  if (!icon) return "file";
  if (KNOWN.has(icon)) return icon as ExhibitIconName;
  return LEGACY_ICONS[icon] ?? "file";
}
