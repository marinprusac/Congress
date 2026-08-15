import { GlobalExhibitSearch, ChamberMark, getChamberIcon } from "@congress/exhibit-ui";

// Real usage: mounted once in every Chamber's ChamberLayout header, and
// once in CapitolHeader.tsx. `open`/dropdown visibility is internal state
// driven only by focus + a non-empty query — there's no prop to force it
// open, so the honest composition is the closed, idle search bar as it
// actually renders on first paint in both real mounting contexts.

// Matches ChamberLayout.tsx's real usage inside a Chamber (e.g. Notes).
export function InChamberHeader() {
  return (
    <div className="flex items-center justify-end bg-parchment p-6">
      <GlobalExhibitSearch ownChamber="notes" navigate={() => {}} renderIcon={getChamberIcon} />
    </div>
  );
}

// Matches CapitolHeader.tsx's real usage — ownChamber="" since Capitol
// owns no exhibits of its own, with an inline ChamberMark renderer instead
// of getChamberIcon.
export function InCapitolHeader() {
  return (
    <div className="flex items-center justify-end border-b border-dust bg-parchment p-6">
      <GlobalExhibitSearch
        ownChamber=""
        navigate={() => {}}
        renderIcon={(chamber) => <ChamberMark name={chamber} />}
      />
    </div>
  );
}
