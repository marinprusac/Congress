import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineChamberEnv } from "@congress/chamber-kit";
import { z } from "zod";

// Relative paths resolve against this Chamber's folder, not Congress's cwd.
const chamberDir = fileURLToPath(new URL("..", import.meta.url));
const inChamber = (path: string) => resolve(chamberDir, path);

export const { env, initEnv } = defineChamberEnv(
  "documents",
  z.object({
    DB_PATH: z.string().default("./data/documents.sqlite3").transform(inChamber),
    FILES_DIR: z.string().default("./data/documents-files").transform(inChamber),
  })
);
