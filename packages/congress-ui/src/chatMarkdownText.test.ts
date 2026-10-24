import { describe, expect, it } from "vitest";
import { recordTokensToLinks, trimPartialToken } from "./chatMarkdownText.js";

describe("recordTokensToLinks", () => {
  it("turns record tokens into record: links, keeping colons in ids", () => {
    expect(recordTokensToLinks("See [[record:calendar:event-3:cal:x|Dinner]] now")).toBe("See [Dinner](<record:calendar:event-3:cal:x>) now");
  });

  it("falls back to the id as label and escapes brackets", () => {
    expect(recordTokensToLinks("[[record:notes:note-1]]")).toBe("[note-1](<record:notes:note-1>)");
    expect(recordTokensToLinks("[[record:notes:n|a [b] c]]")).toBe("[[record:notes:n|a [b] c]]");
    expect(recordTokensToLinks("[[record:notes:n|a \\ b]]")).toBe("[a \\\\ b](<record:notes:n>)");
  });

  it("handles a pipe escaped for a table cell", () => {
    expect(recordTokensToLinks("| [[record:notes:36\\|Standup]] | x |")).toBe("| [Standup](<record:notes:36>) | x |");
  });

  it("leaves non-record wikilinks alone", () => {
    expect(recordTokensToLinks("[[Some Title]]")).toBe("[[Some Title]]");
  });
});

describe("trimPartialToken", () => {
  it("drops an unfinished token at the end only", () => {
    expect(trimPartialToken("Look at [[record:no")).toBe("Look at ");
    expect(trimPartialToken("Look at [[record:notes:n|X]")).toBe("Look at ");
    expect(trimPartialToken("Done [[record:notes:n|X]] ok")).toBe("Done [[record:notes:n|X]] ok");
  });
});
