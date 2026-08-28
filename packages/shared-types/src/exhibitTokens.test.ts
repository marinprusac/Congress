import { describe, expect, it } from "vitest";
import { buildChipToken, buildExhibitToken, parseExhibitToken } from "./exhibitTokens.js";

describe("parseExhibitToken", () => {
  it("splits on the first colon after the prefix, so ids may contain colons", () => {
    // Calendar's Exhibit ids are composite (account:calendar:event), so a
    // naive split(":") here would truncate every calendar reference in the
    // system to its first segment.
    expect(parseExhibitToken("exhibit:calendar:event-3:cal:evt123")).toEqual({
      chamber: "calendar",
      id: "event-3:cal:evt123",
    });
  });

  it("parses an ordinary single-segment id", () => {
    expect(parseExhibitToken("exhibit:notes:note-42")).toEqual({ chamber: "notes", id: "note-42" });
  });

  it("returns null for anything without the exhibit: prefix", () => {
    expect(parseExhibitToken("notes:note-42")).toBeNull();
    expect(parseExhibitToken("Some Note Title")).toBeNull();
    expect(parseExhibitToken("")).toBeNull();
    // Prefix has to be at the start, not merely present.
    expect(parseExhibitToken("see exhibit:notes:note-42")).toBeNull();
  });

  it("returns null when there is no separator after the chamber", () => {
    expect(parseExhibitToken("exhibit:notes")).toBeNull();
  });

  it("returns null for an empty chamber or an empty id", () => {
    expect(parseExhibitToken("exhibit::note-42")).toBeNull();
    expect(parseExhibitToken("exhibit:notes:")).toBeNull();
  });
});

describe("buildExhibitToken", () => {
  it("round-trips through parseExhibitToken", () => {
    for (const ref of [
      { chamber: "notes", id: "note-1" },
      { chamber: "calendar", id: "event-3:cal:evt123" },
      { chamber: "map", id: "place-77" },
    ]) {
      expect(parseExhibitToken(buildExhibitToken(ref))).toEqual(ref);
    }
  });
});

describe("buildChipToken", () => {
  it("wraps the token in the [[target|alias]] syntax the picker inserts", () => {
    expect(buildChipToken({ chamber: "notes", id: "note-7", name: "Weekly review" })).toBe(
      "[[exhibit:notes:note-7|Weekly review]]"
    );
  });
});
