import { ChamberLayout, ChamberMark } from "@congress/congress-ui";

// No header links: the map and "Visits to classify" are views (Search, the
// pinned row, the feed), places are exhibits (the feed, Search, "+").
export function Layout() {
  return <ChamberLayout icon={<ChamberMark name="map" className="h-8 w-8 text-ink" />} title="Map" ownChamber="map" />;
}
