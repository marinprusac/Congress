import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { Autolink } from "@lezer/markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { externalLinkUrlAt, externalUrlFromText } from "./linkClickExtension.js";

function stateFor(doc: string) {
  const state = EditorState.create({ doc, extensions: [markdown({ extensions: [Autolink] })] });
  ensureSyntaxTree(state, doc.length, 5000);
  return state;
}

describe("externalUrlFromText", () => {
  it("accepts http(s) and strips autolink brackets", () => {
    expect(externalUrlFromText("https://a.com/x")).toBe("https://a.com/x");
    expect(externalUrlFromText("<http://a.com>")).toBe("http://a.com");
  });
  it("rejects non-http schemes", () => {
    expect(externalUrlFromText("javascript:alert(1)")).toBeNull();
    expect(externalUrlFromText("/relative")).toBeNull();
  });
});

describe("externalLinkUrlAt", () => {
  it("resolves a markdown link, including inside a bullet", () => {
    const doc = "- see [docs](https://a.com/d) now";
    expect(externalLinkUrlAt(stateFor(doc), doc.indexOf("docs") + 1)).toBe("https://a.com/d");
  });
  it("resolves a bare URL", () => {
    const doc = "go to https://a.com/bare please";
    expect(externalLinkUrlAt(stateFor(doc), doc.indexOf("a.com") + 1)).toBe("https://a.com/bare");
  });
  it("returns null outside links and for non-http links", () => {
    const doc = "plain [x](javascript:alert(1)) text";
    expect(externalLinkUrlAt(stateFor(doc), 2)).toBeNull();
    expect(externalLinkUrlAt(stateFor(doc), doc.indexOf("x") )).toBeNull();
  });
});
