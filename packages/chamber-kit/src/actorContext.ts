import { AsyncLocalStorage } from "node:async_hooks";
import type { MiddlewareHandler } from "hono";
import { ACTOR_HEADER, actorSchema, DEFAULT_ACTOR } from "@congress/shared-types";

// Ambient "who is doing this" for the current request. Chambers publish their
// events deep inside domain functions (createTask, updateNote, ...) that REST
// routes and MCP tools share, so the actor can't be threaded through as a
// parameter without touching every call site - it rides along the async call
// chain instead, and createPublishEvent reads it at publish time. Timers and
// pollers run outside any request, so they fall through to DEFAULT_ACTOR.
const storage = new AsyncLocalStorage<string>();

export function runWithActor<T>(actor: string | null | undefined, fn: () => T): T {
  const parsed = actorSchema.safeParse(actor);
  return parsed.success ? storage.run(parsed.data, fn) : fn();
}

export function currentActor(): string {
  return storage.getStore() ?? DEFAULT_ACTOR;
}

// Hono middleware for a Chamber's /api/* - the gateway (owner session) and
// other services set the header, and a Chamber is only reachable through them.
export const actorMiddleware: MiddlewareHandler = (c, next) => runWithActor(c.req.header(ACTOR_HEADER), () => next());
