import { describe, expect, it } from "vitest";
import { extractRecordTokensWithLabels, extractOutgoingRecordRefs } from "./wikilinks.js";

// Every Chamber that stores body text runs this over it on save and hands
// the result to Congress's exhibit_refs graph, so a miss here silently
// drops a Connection and a false positive creates one to nothing.
describe("extractOutgoingRecordRefs", () => {
  it("returns bare record ids, not the full token", () => {
    expect(extractOutgoingRecordRefs("see [[record:notes:note-3]]")).toEqual(["note-3"]);
  });

  it("reads the target, not the alias", () => {
    expect(extractOutgoingRecordRefs("see [[record:notes:note-3|Some other title]]")).toEqual(["note-3"]);
  });

  it("deduplicates repeated references to the same record", () => {
    const body = "[[record:notes:note-3|first]] and later [[record:notes:note-3|again]]";
    expect(extractOutgoingRecordRefs(body)).toEqual(["note-3"]);
  });

  it("collects references across multiple lines and chambers", () => {
    const body = ["intro [[record:notes:note-1]]", "", "- [[record:tasks:task-9|Do the thing]]", "[[record:map:place-4]]"].join(
      "\n"
    );
    expect(extractOutgoingRecordRefs(body)).toEqual(["note-1", "task-9", "place-4"]);
  });

  it("ignores plain wikilinks that are not record tokens", () => {
    // Notes bodies predate the record token migration and may still contain
    // bare [[Some Title]] links; those are not references to anything
    // addressable and must not reach the refs graph.
    expect(extractOutgoingRecordRefs("[[Some Title]] and [[another/one]]")).toEqual([]);
  });

  it("tolerates surrounding whitespace inside the brackets", () => {
    expect(extractOutgoingRecordRefs("[[  record:notes:note-5  |  Label ]]")).toEqual(["note-5"]);
  });

  it("returns an empty array for text with no links at all", () => {
    expect(extractOutgoingRecordRefs("just some prose")).toEqual([]);
    expect(extractOutgoingRecordRefs("")).toEqual([]);
  });
});

// Feeds chamber-calendar's richTextMirror.projectRichToPlain, which needs
// both the token (to resolve a live label) and the embedded alias (the
// fallback when resolution fails) for every reference in a rich value.
describe("escaped pipes in Markdown tables", () => {
  it("reads [[record:x:y\\|Label]] as the clean token", () => {
    expect(extractRecordTokensWithLabels("| [[record:notes:note-3\\|Standup]] |")).toEqual([
      { chamber: "notes", id: "note-3", token: "record:notes:note-3", label: "Standup" },
    ]);
    expect(extractOutgoingRecordRefs("| [[record:notes:note-3\\|Standup]] |")).toEqual(["note-3"]);
  });
});

describe("extractRecordTokensWithLabels", () => {
  it("returns the full token, chamber, id, and alias", () => {
    expect(extractRecordTokensWithLabels("see [[record:map:place-4|Grandma's House]]")).toEqual([
      { token: "record:map:place-4", chamber: "map", id: "place-4", label: "Grandma's House" },
    ]);
  });

  it("falls back to the bare id as the label when no alias is given", () => {
    expect(extractRecordTokensWithLabels("[[record:map:place-4]]")).toEqual([
      { token: "record:map:place-4", chamber: "map", id: "place-4", label: "place-4" },
    ]);
  });

  it("deduplicates by token, keeping the first alias seen", () => {
    const text = "[[record:map:place-4|First]] later [[record:map:place-4|Second]]";
    expect(extractRecordTokensWithLabels(text)).toEqual([
      { token: "record:map:place-4", chamber: "map", id: "place-4", label: "First" },
    ]);
  });

  it("ignores plain wikilinks that are not record tokens", () => {
    expect(extractRecordTokensWithLabels("[[Some Title]]")).toEqual([]);
  });

  it("returns an empty array for text with no links at all", () => {
    expect(extractRecordTokensWithLabels("just some prose")).toEqual([]);
  });
});
