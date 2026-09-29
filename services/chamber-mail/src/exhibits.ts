import type { ExhibitResolveResult, ExhibitSearchResult } from "@congress/shared-types";
import { createPushExhibitSync, getGoogleAccount, scoreExhibitMatch } from "@congress/chamber-kit";
import { getCachedThreadMessages, parseThreadExhibitId, searchCachedThreads, threadUrl } from "./cache.js";
import { getThreadMetadata } from "./gmail/client.js";
import { headerValue } from "./gmail/mime.js";
import { listManualRefs } from "./refs.js";

export const EXHIBIT_TYPE = "email";

export async function searchMailExhibits(query: string, limit = 10): Promise<ExhibitSearchResult[]> {
  const trimmed = query.trim();
  return searchCachedThreads(query, limit).map((m) => ({
    id: m.exhibitId,
    type: EXHIBIT_TYPE,
    name: m.subject,
    url: m.url,
    ...(trimmed
      ? {
          score: scoreExhibitMatch(trimmed, [
            { text: m.subject, isPrimary: true },
            { text: m.from.name ?? m.from.email ?? "", isPrimary: false },
            { text: m.snippet, isPrimary: false },
          ]),
        }
      : {}),
  }));
}

// Subject of a thread: cached first, else a live metadata fetch.
export async function threadSubject(accountId: number, threadId: string): Promise<string | null> {
  const cached = getCachedThreadMessages(accountId, threadId)[0];
  if (cached) return cached.subject;
  if (!getGoogleAccount(accountId)) return null;
  try {
    const thread = await getThreadMetadata(accountId, threadId);
    const first = thread.messages?.[0];
    if (!first) return null;
    return headerValue(first.payload?.headers, "Subject")?.trim() || "(no subject)";
  } catch {
    return null;
  }
}

export async function resolveMailExhibits(ids: string[]): Promise<ExhibitResolveResult[]> {
  return Promise.all(
    ids.map(async (id): Promise<ExhibitResolveResult> => {
      const parsed = parseThreadExhibitId(id);
      if (!parsed) return { id, deleted: true };
      const subject = await threadSubject(parsed.accountId, parsed.threadId);
      return subject === null ? { id, deleted: true } : { id, name: subject, url: threadUrl(parsed.accountId, parsed.threadId) };
    })
  );
}

export const pushExhibitSync = createPushExhibitSync({ chamber: "mail" });

// Threads only have manual refs, so a sync only follows a Connections change.
export async function resyncThreadExhibit(exhibitId: string): Promise<void> {
  const parsed = parseThreadExhibitId(exhibitId);
  if (!parsed) return;
  const subject = await threadSubject(parsed.accountId, parsed.threadId);
  if (subject === null) return;
  const refs = listManualRefs(exhibitId) ?? [];
  await pushExhibitSync({
    id: exhibitId,
    type: EXHIBIT_TYPE,
    name: subject,
    url: threadUrl(parsed.accountId, parsed.threadId),
    outgoingRefs: refs,
    manualRefs: refs,
  });
}
