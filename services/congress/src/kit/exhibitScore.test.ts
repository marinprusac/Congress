import { describe, expect, it } from "vitest";
import { scoreExhibitMatch } from "./exhibitScore.js";

describe("scoreExhibitMatch", () => {
  it("ranks an exact primary-field match above every other tier", () => {
    const exact = scoreExhibitMatch("esn", [{ text: "ESN", isPrimary: true }]);
    const prefix = scoreExhibitMatch("esn", [{ text: "ESN Kickoff", isPrimary: true }]);
    expect(exact).toBeGreaterThan(prefix);
  });

  it("ranks a primary-field prefix match above a word-boundary match", () => {
    const prefix = scoreExhibitMatch("esn", [{ text: "ESN Kickoff", isPrimary: true }]);
    const wordBoundary = scoreExhibitMatch("esn", [{ text: "Notes on ESN today", isPrimary: true }]);
    expect(prefix).toBeGreaterThan(wordBoundary);
  });

  it("ranks a primary-field word-boundary match above a bare substring match", () => {
    const wordBoundary = scoreExhibitMatch("esn", [{ text: "Notes on ESN today", isPrimary: true }]);
    const substring = scoreExhibitMatch("esn", [{ text: "Xesny device", isPrimary: true }]);
    expect(wordBoundary).toBeGreaterThan(substring);
  });

  it("ranks any primary-field match above every secondary-field match", () => {
    const primarySubstring = scoreExhibitMatch("esn", [{ text: "Xesny device", isPrimary: true }]);
    const secondaryWordBoundary = scoreExhibitMatch("esn", [{ text: "Discuss ESN rollout", isPrimary: false }]);
    expect(primarySubstring).toBeGreaterThan(secondaryWordBoundary);
  });

  it("ranks a secondary-field word-boundary match above a secondary-field substring match", () => {
    const wordBoundary = scoreExhibitMatch("esn", [{ text: "Discuss ESN rollout", isPrimary: false }]);
    const substring = scoreExhibitMatch("esn", [{ text: "Xesny device", isPrimary: false }]);
    expect(wordBoundary).toBeGreaterThan(substring);
  });

  it("is case-insensitive", () => {
    expect(scoreExhibitMatch("ESN", [{ text: "esn", isPrimary: true }])).toBe(
      scoreExhibitMatch("esn", [{ text: "ESN", isPrimary: true }])
    );
  });

  it("returns 0 when no field matches at all", () => {
    expect(scoreExhibitMatch("esn", [{ text: "Weekly review", isPrimary: true }])).toBe(0);
  });

  it("takes the best score across multiple fields", () => {
    const score = scoreExhibitMatch("esn", [
      { text: "Unrelated", isPrimary: true },
      { text: "ESN", isPrimary: false },
    ]);
    const bodyOnly = scoreExhibitMatch("esn", [{ text: "ESN", isPrimary: false }]);
    expect(score).toBe(bodyOnly);
  });
});
