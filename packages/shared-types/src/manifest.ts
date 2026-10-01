import { z } from "zod";

// "offline" means the Chamber failed to start inside Congress. "detached" is
// a manual owner override (see congress/src/registry.ts's detachChamber/
// attachChamber) that survives restarts. The frontend treats both as "not
// active".
export const manifestRoutesSchema = z.object({
  home: z.string(),
  settings: z.string(),
});
export type ManifestRoutes = z.infer<typeof manifestRoutesSchema>;

// One entry per *view* a Chamber offers - a screen that genuinely can't be
// expressed as a list of exhibits (Calendar's Week, the Map, Fitness's
// Health charts). A plain list of exhibits (open tasks, upcoming events) is
// deliberately NOT a view: those exhibits reach the home feed and Search on
// their own. `fullPath` (relative to the Chamber, e.g. "/" for Calendar's Timeline)
// is the full-screen page. `card` says the Chamber also exports a compact
// feed card for it (the component keyed by `id` in its remote-entry `views`
// export, e.g. a map preview); without one the feed shows the view as a
// single row that opens it. A view needs at least one of the two.
export const manifestViewSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
    fullPath: z.string().startsWith("/").optional(),
    card: z.boolean().optional(),
  })
  .refine((v) => v.card === true || v.fullPath !== undefined, { message: "A view needs a feed card, a fullPath, or both." });
export type ManifestView = z.infer<typeof manifestViewSchema>;

// One entry per kind of Exhibit a Chamber lets the owner create - what the
// home screen's "+" sheet lists. `createPath` (relative to the Chamber) opens
// that Chamber's own editor on a new, unsaved Exhibit.
export const manifestExhibitTypeSchema = z.object({
  type: z.string().min(1),
  label: z.string().min(1),
  createPath: z.string().startsWith("/"),
});
export type ManifestExhibitType = z.infer<typeof manifestExhibitTypeSchema>;

// Describes one field of a declared event's payload - deliberately the same
// shape as an MCP tool's own JSON-Schema `properties` entries (see
// chamber-automation's ArgsEditor.tsx), so both sides of a
// trigger-event-payload -> tool-argument template share one mental model.
// Flat only, same restraint ArgsEditor already commits to for tool args: no
// nested objects, and `items` describes an array field's elements one level
// deep, not recursively.
export const manifestEventFieldSchema = z.object({
  type: z.enum(["string", "number", "boolean", "array"]).optional(),
  description: z.string().optional(),
  items: z
    .object({
      type: z.enum(["string", "number", "boolean"]).optional(),
      description: z.string().optional(),
    })
    .optional(),
});
export type ManifestEventField = z.infer<typeof manifestEventFieldSchema>;

// One entry per domain event a Chamber may publish (POST
// /congress/events/publish) - purely a declared catalog for other Chambers'
// own UI (e.g. an automation editor's event-type picker) to read off the
// live registry; Congress itself never inspects this field beyond storing
// and returning it; see events.ts for the actual publish/push-relay
// contract. `type` is conventionally "<chamber>.<event>" (e.g.
// "tasks.due_soon") so it's self-namespacing without a separate chamber
// filter downstream. `payloadFields` is likewise purely descriptive - it
// documents the shape of the object literal passed to `publishEvent` at each
// of that event's actual call sites, kept in sync by hand rather than
// derived, so a template-editing UI (notify title/body/link, an automation's
// arg template) can offer known payload paths instead of requiring the owner
// to already know the shape from reading source.
export const manifestEventSchema = z.object({
  type: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  payloadFields: z.record(z.string(), manifestEventFieldSchema).optional(),
});
export type ManifestEvent = z.infer<typeof manifestEventSchema>;

// Congress is the one publisher with no manifest of its own to declare these
// in - it's the registry owner, not a registrant (see CLAUDE.md), so it never
// appears in the live registry Congress's own eventCatalogSync.ts iterates to
// auto-derive event_settings rows. This is that catalog entry, hand-written
// here instead, so Congress's own events are still configurable
// (notify/record toggles) from Settings -> Logs like any other Chamber's
// declared events - see eventCatalogSync.ts's synthetic-chamber merge and
// registry.ts's actual publish sites.
export const CONGRESS_SYNTHETIC_EVENTS: ManifestEvent[] = [
  {
    type: "google.account_connected",
    label: "Google account connected",
    description: "A Google account was connected (or granted more access) through the Google connector.",
    payloadFields: { accountId: { type: "number" }, label: { type: "string" } },
  },
  {
    type: "google.account_disconnected",
    label: "Google account disconnected",
    description: "A Google account was disconnected from the Google connector.",
    payloadFields: { accountId: { type: "number" }, label: { type: "string" } },
  },
  {
    type: "google.account_needs_reconnect",
    label: "Google account needs reconnect",
    description: "A connected Google account's refresh token was revoked and needs to be reconnected.",
    payloadFields: { accountId: { type: "number" }, label: { type: "string" } },
  },
  {
    type: "congress.app_updated",
    label: "App updated",
    description: "The PWA's service worker activated a newly deployed version and the shell reloaded onto it.",
  },
  {
    type: "logs.rule_updated",
    label: "Log rule updated",
    description: "The owner changed a per-event-type record/notify setting - useful for spotting why an expected notification went quiet.",
    payloadFields: { eventType: { type: "string" }, label: { type: "string" } },
  },
  {
    type: "congress.ai_chat_run",
    label: "AI chat took action",
    description: "A chat message made the assistant call one or more tools.",
    payloadFields: {
      message: { type: "string" },
      summary: { type: "string" },
      toolCallCount: { type: "number" },
      costUsd: { type: "number" },
    },
  },
  {
    type: "congress.ai_proactive_run",
    label: "AI acted on its own",
    description: "Congress's AI ran without being asked - a tracked item's check or a proactive look at what's happening.",
    payloadFields: {
      kind: { type: "string" },
      trigger: { type: "string" },
      summary: { type: "string" },
      toolCallCount: { type: "number" },
      costUsd: { type: "number" },
    },
  },
  {
    type: "congress.type_published",
    label: "Exhibit type changed",
    description: "The owner approved a change to an exhibit type the AI drafted in builder mode.",
    payloadFields: {
      slug: { type: "string" },
      label: { type: "string" },
      version: { type: "number" },
      summary: { type: "string" },
    },
  },
];

export const manifestSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().min(1),
  version: z.string().min(1),
  routes: manifestRoutesSchema,
  // Filled in by Congress when it loads the Chamber (its /mcp/<name> mount).
  mcpUrl: z.string().url().optional(),
  // Home feed views and "+"-creatable Exhibit types - see the schemas above.
  // Defaulted so a Chamber registering an older manifest shape (or one with
  // neither) never has to think about these fields.
  views: z.array(manifestViewSchema).default([]),
  exhibitTypes: z.array(manifestExhibitTypeSchema).default([]),
  // Domain events this Chamber may publish. Defaulted the same way as
  // views - most Chambers publish none.
  events: z.array(manifestEventSchema).default([]),
  // Google OAuth scopes this Chamber needs from Congress's Google connector.
  googleScopes: z.array(z.string()).optional(),
});
export type Manifest = z.infer<typeof manifestSchema>;
