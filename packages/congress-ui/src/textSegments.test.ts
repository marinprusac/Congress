import { describe, expect, it } from "vitest";
import { extractRecordTokens, splitRecordText } from "./textSegments.js";

// What turns a stored body into the chips a reader actually sees
// (<RecordAnnotatedText>), so a change here is a rendering change in every
// Chamber at once.
describe("extractRecordTokens", () => {
  it("returns full tokens, unlike chamber-kit's ref extraction which returns bare ids", () => {
    expect(extractRecordTokens("see [[record:notes:note-3|Label]]")).toEqual(["record:notes:note-3"]);
  });

  it("deduplicates while preserving first-seen order", () => {
    const body = "[[record:tasks:task-2]] then [[record:notes:note-1]] then [[record:tasks:task-2|again]]";
    expect(extractRecordTokens(body)).toEqual(["record:tasks:task-2", "record:notes:note-1"]);
  });

  it("ignores wikilinks that are not record tokens", () => {
    expect(extractRecordTokens("[[Some Title]] and [[record:notes:note-1]]")).toEqual(["record:notes:note-1"]);
  });
});

describe("splitRecordText", () => {
  it("returns a single text segment when there is nothing to link", () => {
    expect(splitRecordText("plain prose")).toEqual([{ type: "text", value: "plain prose" }]);
  });

  it("returns nothing at all for an empty string", () => {
    expect(splitRecordText("")).toEqual([]);
  });

  it("splits surrounding text away from a record reference", () => {
    expect(splitRecordText("before [[record:notes:note-3|Label]] after")).toEqual([
      { type: "text", value: "before " },
      { type: "record", token: "record:notes:note-3", label: "Label" },
      { type: "text", value: " after" },
    ]);
  });

  it("labels a reference with its token when no alias is given", () => {
    expect(splitRecordText("[[record:notes:note-3]]")).toEqual([
      { type: "record", token: "record:notes:note-3", label: "record:notes:note-3" },
    ]);
  });

  it("falls back to the token when the alias is only whitespace", () => {
    expect(splitRecordText("[[record:notes:note-3|   ]]")).toEqual([
      { type: "record", token: "record:notes:note-3", label: "record:notes:note-3" },
    ]);
  });

  it("leaves an invalid [[...]] span as literal text rather than dropping it", () => {
    // Notes bodies predate the token migration; a bare [[Some Title]] must
    // still render as the characters the owner typed.
    expect(splitRecordText("a [[Some Title]] b")).toEqual([{ type: "text", value: "a [[Some Title]] b" }]);
  });

  it("keeps literal text between two adjacent references", () => {
    expect(splitRecordText("[[record:notes:note-1]], [[record:notes:note-2]]")).toEqual([
      { type: "record", token: "record:notes:note-1", label: "record:notes:note-1" },
      { type: "text", value: ", " },
      { type: "record", token: "record:notes:note-2", label: "record:notes:note-2" },
    ]);
  });

  it("handles a reference that is preceded by an invalid one", () => {
    expect(splitRecordText("[[Not A Token]] [[record:notes:note-1|One]]")).toEqual([
      { type: "text", value: "[[Not A Token]] " },
      { type: "record", token: "record:notes:note-1", label: "One" },
    ]);
  });

  it("reassembles losslessly - every character of the input survives", () => {
    const body = "intro [[record:notes:note-1|One]] mid [[Not A Token]] tail [[record:tasks:task-9]]";
    const rebuilt = splitRecordText(body)
      .map((s) => (s.type === "text" ? s.value : `[[${s.token}${s.label === s.token ? "" : `|${s.label}`}]]`))
      .join("");
    expect(rebuilt).toBe(body);
  });
});
