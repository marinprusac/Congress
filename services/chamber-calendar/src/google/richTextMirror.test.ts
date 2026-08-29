import { describe, expect, it } from "vitest";
import { projectRichToPlain, reconcileRichValue } from "./richTextMirror.js";

describe("projectRichToPlain", () => {
  it("substitutes the resolver's current label for a token", () => {
    const rich = "Meet at [[exhibit:map:place-4|Old Name]]";
    expect(projectRichToPlain(rich, () => "New Name")).toBe("Meet at New Name");
  });

  it("falls back to the embedded alias when the resolver has no label", () => {
    const rich = "Meet at [[exhibit:map:place-4|Grandma's House]]";
    expect(projectRichToPlain(rich, () => null)).toBe("Meet at Grandma's House");
  });

  it("falls back to the bare id when there is no alias either", () => {
    const rich = "[[exhibit:map:place-4]]";
    expect(projectRichToPlain(rich, () => null)).toBe("place-4");
  });

  it("leaves plain text with no tokens completely unchanged", () => {
    expect(projectRichToPlain("123 Main St", () => "should never be called")).toBe("123 Main St");
  });

  it("handles multiple distinct tokens in one value", () => {
    const rich = "[[exhibit:map:place-1|A]] and [[exhibit:map:place-2|B]]";
    const resolve = (t: { id: string }) => (t.id === "place-1" ? "Resolved A" : "Resolved B");
    expect(projectRichToPlain(rich, resolve)).toBe("Resolved A and Resolved B");
  });

  it("leaves a bracket span that is not a valid exhibit token untouched", () => {
    expect(projectRichToPlain("[[Not A Token]]", () => "x")).toBe("[[Not A Token]]");
  });
});

describe("reconcileRichValue", () => {
  it("keeps the previous rich value when Google's plain text still matches the projection", () => {
    const result = reconcileRichValue({
      previousRich: "[[exhibit:map:place-4|Cafe]]",
      freshPlain: "Cafe",
      projectedFromPrevious: "Cafe",
    });
    expect(result.rich).toBe("[[exhibit:map:place-4|Cafe]]");
  });

  it("discards the rich value and adopts Google's text verbatim when it has diverged", () => {
    const result = reconcileRichValue({
      previousRich: "[[exhibit:map:place-4|Cafe]]",
      freshPlain: "Cafe (moved to 2nd floor)",
      projectedFromPrevious: "Cafe",
    });
    expect(result.rich).toBe("Cafe (moved to 2nd floor)");
  });

  it("treats Google's plain text as the new rich value verbatim when there was never a stored rich value", () => {
    const result = reconcileRichValue({ previousRich: null, freshPlain: "123 Main St", projectedFromPrevious: null });
    expect(result.rich).toBe("123 Main St");
  });

  it("handles a field that is null on both sides", () => {
    const result = reconcileRichValue({ previousRich: null, freshPlain: null, projectedFromPrevious: null });
    expect(result.rich).toBeNull();
  });
});
