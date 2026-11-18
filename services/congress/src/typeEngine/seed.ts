import { eq } from "drizzle-orm";
import { recordsDb } from "./db/client.js";
import { imports } from "./db/schema.js";
import { installPremades } from "./premade/index.js";
import { deleteType } from "./deleteType.js";
import { getTypeByPremadeKey, PublishError } from "./store.js";

export const DETACHED_KEY = "types-detached";
export const CHAT_REMOVED_KEY = "chat-type-removed";
export const EMAIL_REMOVED_KEY = "email-type-removed";

const ran = (key: string) => Boolean(recordsDb.select().from(imports).where(eq(imports.key, key)).get());
const mark = (key: string, stats: object) => recordsDb.insert(imports).values({ key, ranAt: new Date(), statsJson: JSON.stringify(stats) }).run();

// Built-in types are data, not code: their seed batches run until this marker,
// then never again. From here on every type changes only through operations.
export function seedTypes(): void {
  if (!ran(DETACHED_KEY)) {
    installPremades();
    mark(DETACHED_KEY, {});
  }
  removeChatType();
  removeEmailType();
}

// Once each: chats belong to WhatsApp and mail to Gmail (the AI reads them
// there), so the Chat and Email types and their records go. deleteType
// snapshots the records DB first.
function removeType(key: string, premadeKey: string): void {
  if (ran(key)) return;
  const type = getTypeByPremadeKey(premadeKey);
  try {
    if (type) deleteType(type.id, "congress");
    mark(key, { deleted: Boolean(type) });
  } catch (err) {
    if (!(err instanceof PublishError)) throw err;
    console.warn(`[types] ${premadeKey} type not removed: ${err.message}`);
  }
}

export const removeChatType = () => removeType(CHAT_REMOVED_KEY, "chat");
export const removeEmailType = () => removeType(EMAIL_REMOVED_KEY, "email");
