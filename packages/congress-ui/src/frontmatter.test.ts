import { describe, expect, it } from "vitest";
import { stripFrontmatter } from "./frontmatter.js";

describe("stripFrontmatter", () => {
  it("removes a leading YAML fence and the blank line after it", () => {
    expect(stripFrontmatter("---\ntitle: Hi\n---\n\nBody text")).toBe("Body text");
  });

  it("handles CRLF line endings", () => {
    expect(stripFrontmatter("---\r\ntitle: Hi\r\n---\r\n\r\nBody text")).toBe("Body text");
  });

  it("handles an empty frontmatter block", () => {
    expect(stripFrontmatter("---\n\n---\nBody")).toBe("Body");
  });

  it("leaves content with no frontmatter alone apart from leading whitespace", () => {
    expect(stripFrontmatter("Just a body")).toBe("Just a body");
    expect(stripFrontmatter("\n\n  Just a body")).toBe("Just a body");
  });

  it("only strips a fence at the very start, not a horizontal rule mid-document", () => {
    const body = "Body text\n\n---\n\nMore text";
    expect(stripFrontmatter(body)).toBe(body);
  });

  it("strips only the first fence, leaving a later one as content", () => {
    expect(stripFrontmatter("---\na: 1\n---\nBody\n\n---\n\nMore")).toBe("Body\n\n---\n\nMore");
  });

  it("returns an empty string for a document that is nothing but frontmatter", () => {
    expect(stripFrontmatter("---\ntitle: Hi\n---\n")).toBe("");
  });
});
