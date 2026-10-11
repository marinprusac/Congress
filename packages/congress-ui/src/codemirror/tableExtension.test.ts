import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { Autolink, Table } from "@lezer/markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { parseTable, splitTableRow } from "./tableExtension.js";

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
  });
  it("rejects text without a delimiter row", () => {
    expect(parseTable("| A | B |\n| 1 | 2 |")).toBeNull();
  });
});

describe("markdown parser", () => {
  it("yields a Table node with the GFM Table extension", () => {
    const doc = "| A | B |\n|---|---|\n| 1 | 2 |\n";
    const state = EditorState.create({ doc, extensions: [markdown({ extensions: [Autolink, Table] })] });
    const names: string[] = [];
    ensureSyntaxTree(state, doc.length, 5000)!.iterate({ enter: (n) => void names.push(n.name) });
    expect(names).toContain("Table");
  });
});
