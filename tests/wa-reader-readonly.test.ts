import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// wa-reader must never send anything to WhatsApp. Mirrors the Go guard
// (reader/readonly_test.go) so `pnpm test` - the pre-push hook and CI gate -
// catches a forbidden call even where Go isn't installed.
const READER = join(__dirname, "../services/chamber-whatsapp/reader");

function goFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "bin" && !name.startsWith(".")) goFiles(path, out);
    } else if (name.endsWith(".go") && name !== "readonly_test.go") {
      out.push(path);
    }
  }
  return out;
}

const denylist = readFileSync(join(READER, "readonly-denylist.txt"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

describe("wa-reader stays read-only", () => {
  const files = goFiles(READER);

  it("finds the Go sources and the denylist", () => {
    expect(files.length).toBeGreaterThan(5);
    expect(denylist).toContain("SendMessage");
    expect(denylist).toContain("SendPresence");
  });

  it("references no sending or mutating whatsmeow method", () => {
    const re = new RegExp(`\\.(${denylist.join("|")})\\b`);
    const hits = files.flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .flatMap((line, i) => (re.test(line) ? [`${relative(READER, f)}:${i + 1}: ${line.trim()}`] : [])),
    );
    expect(hits).toEqual([]);
  });

  it("imports whatsmeow's client only from internal/waclient", () => {
    const offenders = files
      .filter((f) => readFileSync(f, "utf8").includes('"go.mau.fi/whatsmeow"'))
      .map((f) => relative(READER, f).split(sep).join("/"))
      .filter((f) => !f.startsWith("internal/waclient/"));
    expect(offenders).toEqual([]);
  });
});
