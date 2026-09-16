import { describe, expect, it } from "vitest";
import { shouldFireDraftCreate } from "./draftCreate.js";

describe("shouldFireDraftCreate", () => {
  it("fires from idle once there's enough to create", () => {
    expect(shouldFireDraftCreate("idle", true)).toBe(true);
  });

  it("does not fire from idle with nothing to create yet", () => {
    expect(shouldFireDraftCreate("idle", false)).toBe(false);
  });

  it("never fires again once already fired, even if canCreate is still true", () => {
    // Guards the double-create case: two blur events in the same tick (or a
    // blur followed by the unmount flush) must not both create an exhibit.
    expect(shouldFireDraftCreate("fired", true)).toBe(false);
  });
});
