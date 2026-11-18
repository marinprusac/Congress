import type { Operation } from "@congress/shared-types";
import { eq } from "drizzle-orm";
import { recordsDb } from "../db/client.js";
import { imports } from "../db/schema.js";
import { getTypeByPremadeKey, markForked, publish, PublishError } from "../store.js";
import { NOTE } from "./note.js";
import { TASK } from "./task.js";
import { DOCUMENT } from "./document.js";
import { PERSON } from "./person.js";
import { EVENT } from "./event.js";
import { ROUTINE, WORKOUT } from "./fitness.js";
import { PLACE } from "./place.js";

// The built-in types' seed: ordered op batches, applied once each like
// migrations until the types are detached (typeEngine/index.ts). After that
// they are ordinary types; these batches only seed a fresh install.

export interface Premade {
  key: string;
  batches: Operation[][];
}

// Event links People, so it comes after Person.
export const PREMADES: Premade[] = [NOTE, TASK, DOCUMENT, PERSON, EVENT, WORKOUT, ROUTINE, PLACE];

export function installPremades(list: Premade[] = PREMADES): void {
  for (const premade of list) {
    const existing = getTypeByPremadeKey(premade.key);
    // The owner deleted it through builder mode; it stays gone.
    if (!existing && recordsDb.select().from(imports).where(eq(imports.key, `premade-deleted:${premade.key}`)).get()) continue;
    if (existing?.forked) continue;
    let typeId = existing?.id;
    for (let i = existing?.premadeBatch ?? 0; i < premade.batches.length; i++) {
      try {
        const { type } = publish({
          typeId,
          ops: premade.batches[i]!,
          actor: "premade",
          origin: "premade",
          premadeKey: premade.key,
          premadeBatch: i + 1,
        });
        typeId = type.id;
      } catch (err) {
        if (!(err instanceof PublishError)) throw err;
        console.warn(`[types] premade "${premade.key}" batch ${i + 1} skipped: ${err.message}`);
        if (typeId) markForked(typeId);
        break;
      }
    }
  }
}

type Binding = Extract<Operation, { op: "set_binding" }>["binding"];

// The batch's binding again, without the given source fields (they become local).
export function unbindSource(batch: Operation[], ...sources: string[]): Operation {
  const op = batch.find((o): o is Extract<Operation, { op: "set_binding" }> => o.op === "set_binding");
  if (!op) throw new Error("no binding in batch");
  const binding: Binding = { ...op.binding, fields: op.binding.fields.filter((f) => !sources.includes(f.source)) };
  return { op: "set_binding", binding };
}
