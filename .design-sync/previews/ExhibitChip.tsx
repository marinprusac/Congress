import { ExhibitChip, getChamberIcon } from "@congress/exhibit-ui";

export function ResolvedWithIcon() {
  return (
    <ExhibitChip
      result={{ id: "note-9", chamber: "notes", name: "Congress Development", url: "/notes/n/9" }}
      renderIcon={getChamberIcon}
      className="exhibit-chip"
    />
  );
}

export function ResolvedNoIcon() {
  return (
    <ExhibitChip
      result={{ id: "event-3", chamber: "calendar", name: "Team Sync — Thursday", url: "/calendar/e/3" }}
      className="exhibit-chip"
    />
  );
}

export function Deleted() {
  return (
    <ExhibitChip
      result={{ id: "note-99", chamber: "notes", deleted: true }}
      fallbackLabel="Old draft"
      renderIcon={getChamberIcon}
      className="exhibit-chip"
    />
  );
}

export function Unavailable() {
  return (
    <ExhibitChip
      result={{ id: "document-4", chamber: "documents", unavailable: true }}
      fallbackLabel="Design doc"
      renderIcon={getChamberIcon}
      className="exhibit-chip"
    />
  );
}
