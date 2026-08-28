import { describe, expect, it } from "vitest";
import { EXHIBIT_LINK_SCHEME, decodeExhibitLinkHref, toMarkdownWithExhibitLinks } from "./wikilinks.js";

describe("toMarkdownWithExhibitLinks", () => {
  it("rewrites a token into a markdown link under the internal scheme", () => {
    expect(toMarkdownWithExhibitLinks("see [[exhibit:notes:note-3|Weekly review]]")).toBe(
      "see [Weekly review](exhibit-ref:exhibit%3Anotes%3Anote-3)"
    );
  });

  it("uses the token itself as the link text when no alias is given", () => {
    expect(toMarkdownWithExhibitLinks("[[exhibit:notes:note-3]]")).toBe(
      "[exhibit:notes:note-3](exhibit-ref:exhibit%3Anotes%3Anote-3)"
    );
  });

  it("falls back to the token when the alias is only whitespace", () => {
    expect(toMarkdownWithExhibitLinks("[[exhibit:notes:note-3|  ]]")).toBe(
      "[exhibit:notes:note-3](exhibit-ref:exhibit%3Anotes%3Anote-3)"
    );
  });

  it("leaves a non-token wikilink exactly as it was", () => {
    expect(toMarkdownWithExhibitLinks("[[Some Title]]")).toBe("[[Some Title]]");
  });

  it("leaves surrounding markdown untouched", () => {
    const body = "# Heading\n\n- item [[exhibit:tasks:task-1|Do it]]\n\n> quote";
    expect(toMarkdownWithExhibitLinks(body)).toBe(
      "# Heading\n\n- item [Do it](exhibit-ref:exhibit%3Atasks%3Atask-1)\n\n> quote"
    );
  });

  it("rewrites every token in a body, not just the first", () => {
    const out = toMarkdownWithExhibitLinks("[[exhibit:notes:note-1]] and [[exhibit:notes:note-2]]");
    expect(out.match(/exhibit-ref:/g)).toHaveLength(2);
  });
});

describe("decodeExhibitLinkHref", () => {
  it("round-trips a token through the encoded href", () => {
    const md = toMarkdownWithExhibitLinks("[[exhibit:calendar:event-3:cal:evt123|Standup]]");
    const href = md.slice(md.indexOf("(") + 1, -1);
    expect(decodeExhibitLinkHref(href)).toBe("exhibit:calendar:event-3:cal:evt123");
  });

  it("returns null for a genuine external link, so it is rendered as one", () => {
    expect(decodeExhibitLinkHref("https://example.com")).toBeNull();
    expect(decodeExhibitLinkHref("/notes/n1")).toBeNull();
    expect(decodeExhibitLinkHref("")).toBeNull();
  });

  it("recognises the scheme it exports", () => {
    expect(decodeExhibitLinkHref(`${EXHIBIT_LINK_SCHEME}exhibit%3Anotes%3Anote-1`)).toBe("exhibit:notes:note-1");
  });
});
