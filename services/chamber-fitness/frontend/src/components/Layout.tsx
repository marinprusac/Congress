import { ChamberLayout, ChamberMark } from "@congress/congress-ui";

// No header links: Health is a view (Search, the pinned row, its feed card),
// workouts and routines are exhibits (the feed, Search, "+").
export function Layout() {
  return <ChamberLayout icon={<ChamberMark name="fitness" className="h-8 w-8 text-ink" />} title="Fitness" ownChamber="fitness" />;
}
