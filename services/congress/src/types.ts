import { z } from "zod";
import { sharePermissionSchema } from "@congress/shared-types";
import { shareClosureEntrySchema } from "./shares.js";

// GET /congress/shared/:token - documents the response shape returned by
// server.ts's sharedApp handler, which builds this object by hand rather
// than parsing through the schema.
export const shareDetailSchema = z.object({
  token: z.string(),
  rootId: z.string(),
  rootChamber: z.string(),
  permission: sharePermissionSchema,
  label: z.string(),
  closure: z.array(shareClosureEntrySchema),
});
export type ShareDetail = z.infer<typeof shareDetailSchema>;
