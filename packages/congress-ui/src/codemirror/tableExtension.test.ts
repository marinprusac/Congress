import { describe, expect, it } from "vitest";
import { findPipeRuns, parseTable, serializeTable, splitTableRow } from "./tableExtension.js";

describe("splitTableRow", () => {
  it("handles outer pipes, escaped pipes and padding", () => {
    expect(splitTableRow("| a | b \\| c |")).toEqual(["a", "b | c"]);
    expect(splitTableRow("a|b")).toEqual(["a", "b"]);
  });
});

describe("parseTable", () => {
  it("reads header, alignment and rows, padding short rows", () => {
    const t = parseTable("| A | B |\n|:--|--:|\n| 1 | 2 |\n| 3 |");
    expect(t?.header).toEqual(["A", "B"]);
    expect(t?.align).toEqual(["left", "right"]);
    expect(t?.rows).toEqual([["1", "2"], ["3", ""]]);
    expect(t?.hasDelimiter).toBe(true);
  });
  it("accepts a block without a delimiter row", () => {
    const t = parseTable("| A | B |\n| 1 | 2 |");
    expect(t?.rows).toEqual([["1", "2"]]);
    expect(t?.hasDelimiter).toBe(false);
  });
});

describe("serializeTable", () => {
  it("round-trips, escaping pipes and keeping a missing delimiter missing", () => {
    const bare = parseTable("| A | B |\n| 1 | x \\| y |")!;
    expect(serializeTable(bare)).toBe("| A | B |\n| 1 | x \\| y |");
    const full = parseTable("| A | B |\n| :-- | --: |\n| 1 | 2 |")!;
    expect(serializeTable(full)).toBe("| A | B |\n| :--- | ---: |\n| 1 | 2 |");
  });
});

describe("findPipeRuns", () => {
  it("finds runs of 2+ pipe lines only", () => {
    const lines = ["text", "| a |", "text", "| a | b |", "| 1 | 2 |", "| 3 | 4 |", ""];
    expect(findPipeRuns(lines)).toEqual([{ start: 3, end: 5 }]);
  });
});
