import type { Manifest } from "@congress/shared-types";
import { MAIL_SCOPES } from "./gmail/client.js";

export const manifest: Manifest = {
  name: "mail",
  displayName: "Mail",
  version: "0.1.0",
  routes: {
    home: "/mail",
    settings: "/mail/settings",
  },
  // No views: threads reach the feed (feedRules.ts) and Search as exhibits.
  // Nothing to create here - Mail is read-only.
  views: [],
  exhibitTypes: [],
  googleScopes: MAIL_SCOPES,
  events: [
    {
      type: "mail.received",
      label: "Mail received",
      description:
        "A new message arrived in a connected inbox. Primary category only, unless Mail's settings include every category; the owner's own sent mail never counts.",
      payloadFields: {
        accountId: { type: "number" },
        account: { type: "string" },
        messageId: { type: "string" },
        threadId: { type: "string" },
        exhibitId: { type: "string" },
        from: { type: "string" },
        fromEmail: { type: "string" },
        subject: { type: "string" },
        snippet: { type: "string" },
        category: { type: "string" },
        url: { type: "string" },
      },
    },
  ],
};
