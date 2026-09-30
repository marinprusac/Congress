import { describe, expect, it } from "vitest";
import { isValidKey, keyHref, savedText } from "./keyLines";

describe("key lines", () => {
  it("saves only valid, trimmed lines", () => {
    expect(savedText("email", [" ana@example.com ", "", "ana@", "bob@work.io"])).toBe("ana@example.com\nbob@work.io");
    expect(savedText("phone", ["+385 91 123 4567", "12"])).toBe("+385 91 123 4567");
  });

  it("validates and links like the server", () => {
    expect(isValidKey("email", "a@b")).toBe(false);
    expect(isValidKey("phone", "(091) 123-4567")).toBe(true);
    expect(keyHref("phone", "+385 (91) 123-4567")).toBe("tel:+385911234567");
    expect(keyHref("email", " ana@example.com")).toBe("mailto:ana@example.com");
  });
});
