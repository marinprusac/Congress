import { afterEach, describe, expect, it, vi } from "vitest";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  vi.resetModules();
});

async function load(set: Record<string, string>) {
  delete process.env.RECORDS_DB_PATH;
  delete process.env.RECORD_FILES_DIR;
  delete process.env.EXHIBITS_DB_PATH;
  delete process.env.EXHIBIT_FILES_DIR;
  Object.assign(process.env, set);
  vi.resetModules();
  return (await import("./env.js")).env;
}

describe("legacy record storage names", () => {
  it("never turns an unset legacy var into the string 'undefined'", async () => {
    const env = await load({});
    expect(env.RECORDS_DB_PATH).not.toContain("undefined");
    expect(env.RECORD_FILES_DIR).not.toContain("undefined");
  });

  it("falls back to the old env var names", async () => {
    const env = await load({ EXHIBITS_DB_PATH: "/old/db.sqlite3", EXHIBIT_FILES_DIR: "/old/files" });
    expect(env.RECORDS_DB_PATH).toBe("/old/db.sqlite3");
    expect(env.RECORD_FILES_DIR).toBe("/old/files");
  });

  it("prefers the new names", async () => {
    const env = await load({ RECORDS_DB_PATH: "/new.sqlite3", EXHIBITS_DB_PATH: "/old.sqlite3" });
    expect(env.RECORDS_DB_PATH).toBe("/new.sqlite3");
  });
});
