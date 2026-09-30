import { describe, expect, it } from "vitest";
import { formatBytes, titleFromFilename } from "./format";

describe("record formatting", () => {
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("turns a filename into a title", () => {
    expect(titleFromFilename("Lease_agreement.pdf")).toBe("Lease agreement");
    expect(titleFromFilename("scan.2026.tar.gz")).toBe("scan.2026.tar");
    expect(titleFromFilename(".env")).toBe(".env");
  });
});
