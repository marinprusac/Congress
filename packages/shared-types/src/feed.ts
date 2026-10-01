import { z } from "zod";

// Congress's home "For You" feed. Each Chamber answers GET /api/feed
// (chamber-kit's mountFeedRoute) with candidates it thinks matter *right
// now* - its own views and exhibits, each scored 0-100 with a short
// human-readable reason ("Starts in 25 min", "Overdue"). The domain
// knowledge of what's urgent stays in the Chamber; Congress only merges and
// ranks (services/congress/src/feed.ts), which is the one place a smarter
// ranker (e.g. Haiku) can later replace.

export const feedScoreSchema = z.number().min(0).max(100);

// What a feed item shows inline - the owner should learn what matters
// without tapping. Built by the owning Chamber (it knows its own data);
// rendered generically by Congress. `time` stays machine-readable (ISO) so
// the browser formats it in the owner's own time zone, never the server's.
export const feedPreviewSchema = z.object({
  // Overrides the resolved exhibit name when the Chamber has a better one.
  title: z.string().max(200).optional(),
  time: z
    .object({
      // Short prefix shown before the time, e.g. "Due", "Since", "Runs".
      label: z.string().max(20).optional(),
      start: z.string(),
      end: z.string().optional(),
      allDay: z.boolean().optional(),
    })
    .optional(),
  // Short facts, shown joined on one line ("Room 4", "5 exercises").
  fields: z.array(z.string().max(80)).max(4).optional(),
  // Plain-text excerpt (a description, a body), clamped to a few lines.
  body: z.string().max(400).optional(),
});
export type FeedPreview = z.infer<typeof feedPreviewSchema>;

export const feedCandidateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("view"), viewId: z.string().min(1), score: feedScoreSchema, reason: z.string().optional() }),
  z.object({
    kind: z.literal("exhibit"),
    exhibitId: z.string().min(1),
    score: feedScoreSchema,
    reason: z.string().optional(),
    preview: feedPreviewSchema.optional(),
  }),
]);
export type FeedCandidate = z.infer<typeof feedCandidateSchema>;


// What GET /congress/feed returns: candidates from every active Chamber,
// merged and ranked, with exhibits resolved to a name/url (a candidate whose
// exhibit no longer resolves is dropped). Only views with a feed card
// appear - a view with nothing to show inline is reached through Search and
// the pinned row instead.
export const feedItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("view"),
    chamber: z.string(),
    viewId: z.string(),
    label: z.string(),
    fullPath: z.string().optional(),
    score: feedScoreSchema,
    reason: z.string().optional(),
  }),
  z.object({
    kind: z.literal("exhibit"),
    chamber: z.string(),
    exhibitId: z.string(),
    name: z.string(),
    url: z.string(),
    score: feedScoreSchema,
    reason: z.string().optional(),
    preview: feedPreviewSchema.optional(),
  }),
]);
export type FeedItem = z.infer<typeof feedItemSchema>;

export const feedResponseSchema = z.object({ items: z.array(feedItemSchema) });
export type FeedResponse = z.infer<typeof feedResponseSchema>;
