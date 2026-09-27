import { describe, expect, it } from "vitest";
import { exhibitTokensToLinks, trimPartialToken } from "./chatMarkdownText.js";

describe("exhibitTokensToLinks", () => {
  it("turns exhibit tokens into exhibit: links, keeping colons in ids", () => {
    expect(exhibitTokensToLinks("See [[exhibit:calendar:event-3:cal:x|Dinner]] now")).toBe("See [Dinner](<exhibit:calendar:event-3:cal:x>) now");
  });

  it("falls back to the id as label and escapes brackets", () => {
    expect(exhibitTokensToLinks("[[exhibit:notes:note-1]]")).toBe("[note-1](<exhibit:notes:note-1>)");
    expect(exhibitTokensToLinks("[[exhibit:notes:n|a [b] c]]")).toBe("[[exhibit:notes:n|a [b] c]]");
    expect(exhibitTokensToLinks("[[exhibit:notes:n|a \\ b]]")).toBe("[a \\\\ b](<exhibit:notes:n>)");
  });

  it("handles a pipe escaped for a table cell", () => {
    expect(exhibitTokensToLinks("| [[exhibit:notes:36\\|Standup]] | x |")).toBe("| [Standup](<exhibit:notes:36>) | x |");
  });

  it("leaves non-exhibit wikilinks alone", () => {
    expect(exhibitTokensToLinks("[[Some Title]]")).toBe("[[Some Title]]");
  });
});

describe("trimPartialToken", () => {
  it("drops an unfinished token at the end only", () => {
    expect(trimPartialToken("Look at [[exhibit:no")).toBe("Look at ");
    expect(trimPartialToken("Look at [[exhibit:notes:n|X]")).toBe("Look at ");
    expect(trimPartialToken("Done [[exhibit:notes:n|X]] ok")).toBe("Done [[exhibit:notes:n|X]] ok");
  });
});
