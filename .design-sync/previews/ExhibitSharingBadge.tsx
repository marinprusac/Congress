import { ExhibitSharingBadge } from "@congress/exhibit-ui";

// Renders nothing when the exhibit has no shares - the mock backend always
// returns one direct share for any exhibitId, which is what makes the badge
// visible at all here. There's only one visually interesting state (direct
// share, since indirect/inherited looks the same minus one CSS attribute),
// so a single story showing it in the header context it actually ships in
// is the useful one.
export function SharedInHeader() {
  return (
    <h2 className="flex items-center gap-3 font-display text-3xl text-ink">
      Congress Development
      <ExhibitSharingBadge exhibitId="note-9" className="exhibit-sharing-badge" />
    </h2>
  );
}
