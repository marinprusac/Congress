import { describe, expect, it } from "vitest";
import { extractExhibitTokensWithLabels, extractOutgoingExhibitRefs } from "./wikilinks.js";

// Every Chamber that stores body text runs this over it on save and hands
// the result to Congress's exhibit_refs graph, so a miss here silently
// drops a Connection and a false positive creates one to nothing.
describe("extractOutgoingExhibitRefs", () => {
  it("returns bare exhibit ids, not the full token", () => {
    expect(extractOutgoingExhibitRefs("see [[exhibit:notes:note-3]]")).toEqual(["note-3"]);
  });

  it("reads the target, not the alias", () => {
    expect(extractOutgoingExhibitRefs("see [[exhibit:notes:note-3|Some other title]]")).toEqual(["note-3"]);
  });

  it("deduplicates repeated references to the same exhibit", () => {
    const body = "[[exhibit:notes:note-3|first]] and later [[exhibit:notes:note-3|again]]";
    expect(extractOutgoingExhibitRefs(body)).toEqual(["note-3"]);
  });

  it("collects references across multiple lines and chambers", () => {
    const body = ["intro [[exhibit:notes:note-1]]", "", "- [[exhibit:tasks:task-9|Do the thing]]", "[[exhibit:map:place-4]]"].join(
      "\n"
    );
    expect(extractOutgoingExhibitRefs(body)).toEqual(["note-1", "task-9", "place-4"]);
  });

  it("ignores plain wikilinks that are not exhibit tokens", () => {
    // Notes bodies predate the exhibit token migration and may still contain
    // bare [[Some Title]] links; those are not references to anything
    // addressable and must not reach the refs graph.
    expect(extractOutgoingExhibitRefs("[[Some Title]] and [[another/one]]")).toEqual([]);
  });

  it("tolerates surrounding whitespace inside the brackets", () => {
    expect(extractOutgoingExhibitRefs("[[  exhibit:notes:note-5  |  Label ]]")).toEqual(["note-5"]);
  });

  it("returns an empty array for text with no links at all", () => {
    expect(extractOutgoingExhibitRefs("just some prose")).toEqual([]);
    expect(extractOutgoingExhibitRefs("")).toEqual([]);
  });
});

// Feeds chamber-calendar's richTextMirror.projectRichToPlain, which needs
// both the token (to resolve a live label) and the embedded alias (the
// fallback when resolution fails) for every reference in a rich value.
describe("extractExhibitTokensWithLabels", () => {
  it("returns the full token, chamber, id, and alias", () => {
    expect(extractExhibitTokensWithLabels("see [[exhibit:map:place-4|Grandma's House]]")).toEqual([
      { token: "exhibit:map:place-4", chamber: "map", id: "place-4", label: "Grandma's House" },
    ]);
  });

  it("falls back to the bare id as the label when no alias is given", () => {
    expect(extractExhibitTokensWithLabels("[[exhibit:map:place-4]]")).toEqual([
      { token: "exhibit:map:place-4", chamber: "map", id: "place-4", label: "place-4" },
    ]);
  });

  it("deduplicates by token, keeping the first alias seen", () => {
    const text = "[[exhibit:map:place-4|First]] later [[exhibit:map:place-4|Second]]";
    expect(extractExhibitTokensWithLabels(text)).toEqual([
      { token: "exhibit:map:place-4", chamber: "map", id: "place-4", label: "First" },
    ]);
  });

  it("ignores plain wikilinks that are not exhibit tokens", () => {
    expect(extractExhibitTokensWithLabels("[[Some Title]]")).toEqual([]);
  });

  it("returns an empty array for text with no links at all", () => {
    expect(extractExhibitTokensWithLabels("just some prose")).toEqual([]);
  });
});
