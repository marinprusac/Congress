import { describe, expect, it } from "vitest";
import { extractExhibitTokens, splitExhibitText } from "./textSegments.js";

// What turns a stored body into the chips a reader actually sees
// (<ExhibitAnnotatedText>), so a change here is a rendering change in every
// Chamber at once.
describe("extractExhibitTokens", () => {
  it("returns full tokens, unlike chamber-kit's ref extraction which returns bare ids", () => {
    expect(extractExhibitTokens("see [[exhibit:notes:note-3|Label]]")).toEqual(["exhibit:notes:note-3"]);
  });

  it("deduplicates while preserving first-seen order", () => {
    const body = "[[exhibit:tasks:task-2]] then [[exhibit:notes:note-1]] then [[exhibit:tasks:task-2|again]]";
    expect(extractExhibitTokens(body)).toEqual(["exhibit:tasks:task-2", "exhibit:notes:note-1"]);
  });

  it("ignores wikilinks that are not exhibit tokens", () => {
    expect(extractExhibitTokens("[[Some Title]] and [[exhibit:notes:note-1]]")).toEqual(["exhibit:notes:note-1"]);
  });
});

describe("splitExhibitText", () => {
  it("returns a single text segment when there is nothing to link", () => {
    expect(splitExhibitText("plain prose")).toEqual([{ type: "text", value: "plain prose" }]);
  });

  it("returns nothing at all for an empty string", () => {
    expect(splitExhibitText("")).toEqual([]);
  });

  it("splits surrounding text away from an exhibit reference", () => {
    expect(splitExhibitText("before [[exhibit:notes:note-3|Label]] after")).toEqual([
      { type: "text", value: "before " },
      { type: "exhibit", token: "exhibit:notes:note-3", label: "Label" },
      { type: "text", value: " after" },
    ]);
  });

  it("labels a reference with its token when no alias is given", () => {
    expect(splitExhibitText("[[exhibit:notes:note-3]]")).toEqual([
      { type: "exhibit", token: "exhibit:notes:note-3", label: "exhibit:notes:note-3" },
    ]);
  });

  it("falls back to the token when the alias is only whitespace", () => {
    expect(splitExhibitText("[[exhibit:notes:note-3|   ]]")).toEqual([
      { type: "exhibit", token: "exhibit:notes:note-3", label: "exhibit:notes:note-3" },
    ]);
  });

  it("leaves an invalid [[...]] span as literal text rather than dropping it", () => {
    // Notes bodies predate the token migration; a bare [[Some Title]] must
    // still render as the characters the owner typed.
    expect(splitExhibitText("a [[Some Title]] b")).toEqual([{ type: "text", value: "a [[Some Title]] b" }]);
  });

  it("keeps literal text between two adjacent references", () => {
    expect(splitExhibitText("[[exhibit:notes:note-1]], [[exhibit:notes:note-2]]")).toEqual([
      { type: "exhibit", token: "exhibit:notes:note-1", label: "exhibit:notes:note-1" },
      { type: "text", value: ", " },
      { type: "exhibit", token: "exhibit:notes:note-2", label: "exhibit:notes:note-2" },
    ]);
  });

  it("handles a reference that is preceded by an invalid one", () => {
    expect(splitExhibitText("[[Not A Token]] [[exhibit:notes:note-1|One]]")).toEqual([
      { type: "text", value: "[[Not A Token]] " },
      { type: "exhibit", token: "exhibit:notes:note-1", label: "One" },
    ]);
  });

  it("reassembles losslessly - every character of the input survives", () => {
    const body = "intro [[exhibit:notes:note-1|One]] mid [[Not A Token]] tail [[exhibit:tasks:task-9]]";
    const rebuilt = splitExhibitText(body)
      .map((s) => (s.type === "text" ? s.value : `[[${s.token}${s.label === s.token ? "" : `|${s.label}`}]]`))
      .join("");
    expect(rebuilt).toBe(body);
  });
});
