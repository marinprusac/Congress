import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineChamberEnv } from "@congress/chamber-kit";
import { z } from "zod";

const chamberDir = fileURLToPath(new URL("..", import.meta.url));

// The same .env is the daemon's EnvironmentFile; this Chamber only needs the socket.
export const { env, initEnv } = defineChamberEnv(
  "whatsapp",
  z.object({
    WA_READER_SOCKET: z
      .string()
      .default("/run/wa-reader/api.sock")
      .transform((p) => resolve(chamberDir, p)),
  })
);
