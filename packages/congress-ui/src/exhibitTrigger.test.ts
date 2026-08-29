import { describe, expect, it } from "vitest";
import { buildChipInsertion, detectExhibitTrigger } from "./exhibitTrigger.js";

describe("detectExhibitTrigger", () => {
  it("fires at the very start of the field", () => {
    expect(detectExhibitTrigger("@", 1)).toEqual({ triggerStart: 0, query: "" });
  });

  it("fires immediately after whitespace", () => {
    expect(detectExhibitTrigger("hello @wor", 10)).toEqual({ triggerStart: 6, query: "wor" });
  });

  it("does not fire mid-word", () => {
    expect(detectExhibitTrigger("foo@bar", 7)).toBeNull();
  });

  it("keeps accumulating the query through embedded spaces", () => {
    expect(detectExhibitTrigger("hello @my note title", 21)).toEqual({
      triggerStart: 6,
      query: "my note title",
    });
  });

  it("closes when a newline has been typed since the @", () => {
    expect(detectExhibitTrigger("@foo\nbar", 8)).toBeNull();
  });

  it("tracks the most recent @ before the cursor", () => {
    expect(detectExhibitTrigger("foo @bar @baz", 13)).toEqual({ triggerStart: 9, query: "baz" });
  });

  it("returns null when there is no @ before the cursor at all", () => {
    expect(detectExhibitTrigger("just some prose", 16)).toBeNull();
    expect(detectExhibitTrigger("", 0)).toBeNull();
  });

  it("ignores an @ that appears only after the cursor", () => {
    expect(detectExhibitTrigger("foo @bar", 3)).toBeNull();
  });
});

describe("buildChipInsertion", () => {
  it("builds the literal bracket-token text and splice range", () => {
    expect(
      buildChipInsertion({ triggerStart: 6, cursor: 10, chamber: "map", id: "place-4", name: "Grandma's House" })
    ).toEqual({
      text: "[[exhibit:map:place-4|Grandma's House]]",
      from: 6,
      to: 10,
    });
  });

  it("does not escape special characters in the name - callers must not offer a name containing ]]", () => {
    // Exhibit names come from search results/quick-create, both of which are
    // free text - a name containing "]]" would corrupt the token boundary.
    // This is a known, accepted limitation shared with the old "[[" picker
    // (buildChipToken never escaped either), not a regression.
    const insertion = buildChipInsertion({ triggerStart: 0, cursor: 1, chamber: "notes", id: "note-1", name: "a|b" });
    expect(insertion.text).toBe("[[exhibit:notes:note-1|a|b]]");
  });
});
