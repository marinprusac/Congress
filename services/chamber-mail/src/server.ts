import { Hono, type Context } from "hono";
import type { HttpBindings } from "@hono/node-server";
import {
  actorMiddleware,
  mountExhibitSearchRoutes,
  mountSettingsRoutes,
  mountManualRefsRoutes,
  mountFeedRoute,
  GoogleAccountNeedsReconnectError,
  GoogleAccountNotFoundError,
  GoogleScopeMissingError,
} from "@congress/chamber-kit";
import { updateSettingsRequestSchema } from "./types.js";
import { mailFeedCandidates } from "./feedRules.js";
import { getSettings, updateSettings } from "./settings.js";
import { searchMailExhibits, resolveMailExhibits, resyncThreadExhibit } from "./exhibits.js";
import { listManualRefs, addManualRef, removeManualRef } from "./refs.js";
import { listCachedMessages } from "./cache.js";
import { syncAll } from "./sync.js";
import { GmailApiError } from "./gmail/client.js";
import {
  AttachmentNotFoundError,
  MailAccountNotFoundError,
  getAttachment,
  getThread,
  listAccountLabels,
  listMailAccounts,
  mailboxSummary,
  searchThreads,
} from "./mail.js";

export const app = new Hono<{ Bindings: HttpBindings }>();

function mapError(c: Context, err: unknown): Response {
  if (err instanceof MailAccountNotFoundError || err instanceof GoogleAccountNotFoundError || err instanceof AttachmentNotFoundError) {
    return c.json({ error: "not_found", message: err.message }, 404);
  }
  if (err instanceof GoogleScopeMissingError) {
    return c.json({ error: "access_not_granted", accountId: err.accountId, message: err.message }, 409);
  }
  if (err instanceof GoogleAccountNeedsReconnectError) {
    return c.json({ error: "account_needs_reconnect", accountId: err.accountId, message: err.message }, 409);
  }
  if (err instanceof GmailApiError) {
    if (err.status === 404) return c.json({ error: "not_found", message: "Not found in Gmail" }, 404);
    return c.json({ error: "gmail_api_error", status: err.status, message: err.message }, 502);
  }
  throw err;
}

function intParam(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isInteger(n) ? n : Number.NaN;
}

// Stamps who made each request - see actorContext.ts.
app.use("/api/*", actorMiddleware);

app.get("/api/accounts", (c) => c.json(listMailAccounts()));

app.post("/api/sync", async (c) => {
  await syncAll();
  return c.json(listMailAccounts());
});

app.get("/api/summary", async (c) => c.json(await mailboxSummary()));

app.get("/api/messages/recent", (c) => {
  const accountId = intParam(c.req.query("accountId"));
  const limit = intParam(c.req.query("limit"));
  if (Number.isNaN(accountId) || Number.isNaN(limit)) return c.json({ error: "invalid_request" }, 400);
  return c.json(
    listCachedMessages({
      accountId,
      unreadOnly: c.req.query("unreadOnly") === "true",
      inboxOnly: c.req.query("inboxOnly") !== "false",
      limit: Math.min(limit ?? 50, 200),
    })
  );
});

app.get("/api/search", async (c) => {
  const q = c.req.query("q")?.trim();
  if (!q) return c.json({ threads: [], errors: [] });
  const accountId = intParam(c.req.query("accountId"));
  if (Number.isNaN(accountId)) return c.json({ error: "invalid_request" }, 400);
  try {
    return c.json(await searchThreads(q, { accountId, maxResults: 25 }));
  } catch (err) {
    return mapError(c, err);
  }
});

app.get("/api/threads/:accountId/:threadId", async (c) => {
  const accountId = Number(c.req.param("accountId"));
  if (!Number.isInteger(accountId)) return c.json({ error: "invalid_account_id" }, 400);
  try {
    return c.json(await getThread(accountId, c.req.param("threadId"), { includeHtml: true }));
  } catch (err) {
    return mapError(c, err);
  }
});

app.get("/api/labels/:accountId", async (c) => {
  const accountId = Number(c.req.param("accountId"));
  if (!Number.isInteger(accountId)) return c.json({ error: "invalid_account_id" }, 400);
  try {
    return c.json(await listAccountLabels(accountId));
  } catch (err) {
    return mapError(c, err);
  }
});

// Streams one attachment back as a download.
app.get("/api/messages/:accountId/:messageId/attachments/:attachmentId", async (c) => {
  const accountId = Number(c.req.param("accountId"));
  if (!Number.isInteger(accountId)) return c.json({ error: "invalid_account_id" }, 400);
  try {
    const data = await getAttachment(accountId, c.req.param("messageId"), c.req.param("attachmentId"));
    const filename = (c.req.query("filename") ?? "attachment").replace(/["\r\n]/g, "");
    const mimeType = /^[\w.+-]+\/[\w.+-]+$/.test(c.req.query("mimeType") ?? "") ? c.req.query("mimeType")! : "application/octet-stream";
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return mapError(c, err);
  }
});

mountExhibitSearchRoutes(app, { search: searchMailExhibits, resolve: resolveMailExhibits });

// Home feed candidates - see feedRules.ts.
mountFeedRoute(app, async (now) => {
  const settings = await getSettings();
  const since = new Date(now.getTime() - settings.feedWindowHours * 60 * 60 * 1000);
  const labels = new Map(listMailAccounts().filter((a) => a.hasAccess).map((a) => [a.id, a.label]));
  return mailFeedCandidates(listCachedMessages({ unreadOnly: true, inboxOnly: true, since, limit: 200 }), settings, labels, now);
});

mountManualRefsRoutes(app, { list: listManualRefs, add: addManualRef, remove: removeManualRef }, resyncThreadExhibit);

mountSettingsRoutes(app, { getSettings, updateSettings }, updateSettingsRequestSchema);
