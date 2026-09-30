import type { Operation } from "@congress/shared-types";
import { getTypeByPremadeKey, markForked, publish, PublishError } from "../store.js";
import { NOTE } from "./note.js";
import { TASK } from "./task.js";
import { DOCUMENT } from "./document.js";
import { PERSON } from "./person.js";
import { EVENT } from "./event.js";
import { EMAIL } from "./email.js";
import { ROUTINE, WORKOUT } from "./fitness.js";

// Premade types ship as ordered batches of operations, applied once each at
// boot like migrations. A batch that no longer applies (the owner changed the
// type) marks it forked and is skipped; boot never fails over it.

export interface Premade {
  key: string;
  batches: Operation[][];
}

// Event and Email link People, so they come after Person.
export const PREMADES: Premade[] = [NOTE, TASK, DOCUMENT, PERSON, EVENT, EMAIL, WORKOUT, ROUTINE];

export function installPremades(list: Premade[] = PREMADES): void {
  for (const premade of list) {
    const existing = getTypeByPremadeKey(premade.key);
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
