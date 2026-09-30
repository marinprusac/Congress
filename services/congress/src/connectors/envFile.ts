import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "dotenv";

// A folder's own .env (e.g. the wa-reader daemon's, which it shares with its connector).
export function readEnvFile(dir: string): Record<string, string> {
  const path = join(dir, ".env");
  return existsSync(path) ? parse(readFileSync(path)) : {};
}
