import { createPublishEvent } from "@congress/chamber-kit";
import { env } from "./env.js";

export const publishEvent = createPublishEvent({
  chamber: "logs",
  capitolUrl: env.CAPITOL_URL,
  internalToken: env.CONGRESS_INTERNAL_TOKEN,
});
