import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineChamberEnv } from "@congress/chamber-kit";
import { z } from "zod";

// Relative paths resolve against this Chamber's folder, not Congress's cwd.
const chamberDir = fileURLToPath(new URL("..", import.meta.url));
const inChamber = (path: string) => resolve(chamberDir, path);

// Read from this Chamber's own .env by Congress when it loads the module.
export const { env, initEnv } = defineChamberEnv(
  "__CHAMBER_NAME__",
  z.object({
    DB_PATH: z.string().default("./data/__CHAMBER_NAME__.sqlite3").transform(inChamber),
  })
);
