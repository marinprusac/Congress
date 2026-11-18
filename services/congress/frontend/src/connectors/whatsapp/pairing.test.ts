import { describe, expect, it } from "vitest";
import { qrPath } from "./pairing";

describe("WhatsApp pairing", () => {
  it("draws a QR code's dark modules inside its quiet zone", () => {
    expect(qrPath(["10", "01"], 4)).toBe("M4 4h1v1h-1zM5 5h1v1h-1z");
  });
});
