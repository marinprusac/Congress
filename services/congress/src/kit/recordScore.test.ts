import { describe, expect, it } from "vitest";
import { scoreRecordMatch } from "./recordScore.js";

describe("scoreRecordMatch", () => {
  it("ranks an exact primary-field match above every other tier", () => {
    const exact = scoreRecordMatch("esn", [{ text: "ESN", isPrimary: true }]);
    const prefix = scoreRecordMatch("esn", [{ text: "ESN Kickoff", isPrimary: true }]);
    expect(exact).toBeGreaterThan(prefix);
  });

  it("ranks a primary-field prefix match above a word-boundary match", () => {
    const prefix = scoreRecordMatch("esn", [{ text: "ESN Kickoff", isPrimary: true }]);
    const wordBoundary = scoreRecordMatch("esn", [{ text: "Notes on ESN today", isPrimary: true }]);
    expect(prefix).toBeGreaterThan(wordBoundary);
  });

  it("ranks a primary-field word-boundary match above a bare substring match", () => {
    const wordBoundary = scoreRecordMatch("esn", [{ text: "Notes on ESN today", isPrimary: true }]);
    const substring = scoreRecordMatch("esn", [{ text: "Xesny device", isPrimary: true }]);
    expect(wordBoundary).toBeGreaterThan(substring);
  });

  it("ranks any primary-field match above every secondary-field match", () => {
    const primarySubstring = scoreRecordMatch("esn", [{ text: "Xesny device", isPrimary: true }]);
    const secondaryWordBoundary = scoreRecordMatch("esn", [{ text: "Discuss ESN rollout", isPrimary: false }]);
    expect(primarySubstring).toBeGreaterThan(secondaryWordBoundary);
  });

  it("ranks a secondary-field word-boundary match above a secondary-field substring match", () => {
    const wordBoundary = scoreRecordMatch("esn", [{ text: "Discuss ESN rollout", isPrimary: false }]);
    const substring = scoreRecordMatch("esn", [{ text: "Xesny device", isPrimary: false }]);
    expect(wordBoundary).toBeGreaterThan(substring);
  });

  it("is case-insensitive", () => {
    expect(scoreRecordMatch("ESN", [{ text: "esn", isPrimary: true }])).toBe(
      scoreRecordMatch("esn", [{ text: "ESN", isPrimary: true }])
    );
  });

  it("returns 0 when no field matches at all", () => {
    expect(scoreRecordMatch("esn", [{ text: "Weekly review", isPrimary: true }])).toBe(0);
  });

  it("takes the best score across multiple fields", () => {
    const score = scoreRecordMatch("esn", [
      { text: "Unrelated", isPrimary: true },
      { text: "ESN", isPrimary: false },
    ]);
    const bodyOnly = scoreRecordMatch("esn", [{ text: "ESN", isPrimary: false }]);
    expect(score).toBe(bodyOnly);
  });
});
