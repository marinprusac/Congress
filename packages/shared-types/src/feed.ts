import { z } from "zod";

// Congress's home "For You" feed. Each Chamber answers GET /api/feed
// (chamber-kit's mountFeedRoute) with candidates it thinks matter *right
// now* - its own views and exhibits, each scored 0-100 with a short
// human-readable reason ("Starts in 25 min", "Overdue"). The domain
// knowledge of what's urgent stays in the Chamber; Congress only merges and
// ranks (services/congress/src/feed.ts), which is the one place a smarter
// ranker (e.g. Haiku) can later replace.

export const feedScoreSchema = z.number().min(0).max(100);

export const feedCandidateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("view"), viewId: z.string().min(1), score: feedScoreSchema, reason: z.string().optional() }),
  z.object({ kind: z.literal("exhibit"), exhibitId: z.string().min(1), score: feedScoreSchema, reason: z.string().optional() }),
]);
export type FeedCandidate = z.infer<typeof feedCandidateSchema>;

export const chamberFeedResponseSchema = z.object({ items: z.array(feedCandidateSchema) });
export type ChamberFeedResponse = z.infer<typeof chamberFeedResponseSchema>;

// What GET /congress/feed returns: candidates from every active Chamber,
// merged and ranked, with exhibits resolved to a name/url (a candidate whose
// exhibit no longer resolves is dropped).
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
  }),
]);
export type FeedItem = z.infer<typeof feedItemSchema>;

export const feedResponseSchema = z.object({ items: z.array(feedItemSchema) });
export type FeedResponse = z.infer<typeof feedResponseSchema>;
