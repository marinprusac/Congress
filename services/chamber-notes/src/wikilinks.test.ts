import { describe, expect, it } from "vitest";
import { extractWikiLinks, makeExcerpt } from "./wikilinks.js";

describe("extractWikiLinks", () => {
  it("extracts a bare [[Target]] with a null alias", () => {
    expect(extractWikiLinks("See [[Weekly Review]] for details.")).toEqual([{ target: "Weekly Review", alias: null }]);
  });

  it("extracts a [[Target|Alias]] pair", () => {
    expect(extractWikiLinks("[[note-3|My Review]]")).toEqual([{ target: "note-3", alias: "My Review" }]);
  });

  it("trims whitespace inside both target and alias", () => {
    expect(extractWikiLinks("[[ Weekly Review | My Review ]]")).toEqual([{ target: "Weekly Review", alias: "My Review" }]);
  });

  it("treats a whitespace-only alias as null", () => {
    expect(extractWikiLinks("[[Weekly Review| ]]")).toEqual([{ target: "Weekly Review", alias: null }]);
  });

  it("skips a link whose target is whitespace-only", () => {
    expect(extractWikiLinks("[[ ]]")).toEqual([]);
  });

  it("does not recognize a literal empty alias ([[Target|]]) as a wikilink at all", () => {
    // The underlying WIKILINK_PATTERN requires at least one character after
    // "|" for the alias group to engage, so this is left as plain text
    // rather than producing a {target, alias:null} entry.
    expect(extractWikiLinks("[[Weekly Review|]]")).toEqual([]);
  });

  it("collects multiple links across a multiline body, in document order", () => {
    const markdown = "First [[A]]\nthen [[B|Beta]]\nand [[C]].";
    expect(extractWikiLinks(markdown)).toEqual([
      { target: "A", alias: null },
      { target: "B", alias: "Beta" },
      { target: "C", alias: null },
    ]);
  });

  it("returns an empty array for text with no links", () => {
    expect(extractWikiLinks("Nothing to see here.")).toEqual([]);
  });

  it("returns an empty array for an empty string", () => {
    expect(extractWikiLinks("")).toEqual([]);
  });
});

describe("makeExcerpt", () => {
  it("renders a wikilink as its alias when present", () => {
    expect(makeExcerpt("See [[exhibit:notes:note-3|Weekly review]] for context.")).toBe("See Weekly review for context.");
  });

  it("renders a wikilink as its bare target when no alias is given", () => {
    expect(makeExcerpt("See [[Weekly Review]] for context.")).toBe("See Weekly Review for context.");
  });

  it("strips leading heading markers but not a mid-line #", () => {
    expect(makeExcerpt("# Title\nBody with a #hashtag inline")).toBe("Title Body with a #hashtag inline");
  });

  it("strips markdown emphasis/quote characters", () => {
    expect(makeExcerpt("*bold* _italic_ `code` >quoted")).toBe("bold italic code quoted");
  });

  it("collapses runs of whitespace and newlines into single spaces, trimmed", () => {
    expect(makeExcerpt("  Line one\n\n  Line   two  ")).toBe("Line one Line two");
  });

  it("does not truncate or append an ellipsis when under the limit", () => {
    expect(makeExcerpt("Short body")).toBe("Short body");
  });

  it("truncates to the default 180 chars with a trailing ellipsis when over the limit", () => {
    const long = "a".repeat(200);
    const excerpt = makeExcerpt(long);
    expect(excerpt).toBe(`${"a".repeat(180)}…`);
  });

  it("respects a custom maxLength argument", () => {
    expect(makeExcerpt("abcdefghij", 5)).toBe("abcde…");
  });

  it("truncates at the raw character boundary, potentially mid-word", () => {
    // trimEnd() at the cut point only removes trailing whitespace, not back
    // to the nearest word boundary - pinning current behaviour rather than
    // an idealized one that isn't actually implemented.
    expect(makeExcerpt("one two three", 5)).toBe("one t…");
  });
});
