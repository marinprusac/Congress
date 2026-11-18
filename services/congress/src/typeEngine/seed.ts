import { eq } from "drizzle-orm";
import { recordsDb } from "./db/client.js";
import { imports } from "./db/schema.js";
import { installPremades } from "./premade/index.js";
import { deleteType } from "./deleteType.js";
import { getTypeByPremadeKey, PublishError } from "./store.js";

export const DETACHED_KEY = "types-detached";
export const CHAT_REMOVED_KEY = "chat-type-removed";

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
}

// Once: chats belong to WhatsApp (the AI reads them there), so the Chat type
// and its records go. deleteType snapshots the records DB first.
export function removeChatType(): void {
  if (ran(CHAT_REMOVED_KEY)) return;
  const chat = getTypeByPremadeKey("chat");
  try {
    if (chat) deleteType(chat.id, "congress");
    mark(CHAT_REMOVED_KEY, { deleted: Boolean(chat) });
  } catch (err) {
    if (!(err instanceof PublishError)) throw err;
    console.warn(`[types] Chat type not removed: ${err.message}`);
  }
}
