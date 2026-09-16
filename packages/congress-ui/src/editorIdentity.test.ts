import { describe, expect, it } from "vitest";
import { resolveEditorIdentity } from "./editorIdentity.js";

describe("resolveEditorIdentity", () => {
  it("keeps local draft state when the URL just caught up with a self-navigate after create", () => {
    expect(resolveEditorIdentity(31, 31)).toBe("keep");
  });

  it("keeps state on initial mount where the url id and seeded state already agree", () => {
    expect(resolveEditorIdentity(null, null)).toBe("keep");
  });

  it("resets when the user navigates to a genuinely different persisted id", () => {
    expect(resolveEditorIdentity(31, 30)).toBe("reset");
  });

  it("resets when navigating from an existing item back to the draft/new route", () => {
    expect(resolveEditorIdentity(null, 30)).toBe("reset");
  });

  it("resets when navigating from the draft route to an existing item directly", () => {
    expect(resolveEditorIdentity(30, null)).toBe("reset");
  });

  it("works with string ids too (e.g. an externally-assigned id like Hevy's routine ids)", () => {
    expect(resolveEditorIdentity("abc", "abc")).toBe("keep");
    expect(resolveEditorIdentity("abc", "def")).toBe("reset");
  });
});
