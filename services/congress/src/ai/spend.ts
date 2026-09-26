import { gte, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { aiSpend } from "../db/schema.js";

// One row per headless `claude` invocation, cost only - just enough for
// engine.ts's runAi to enforce the shared daily budget cap.
export function recordSpend(actor: string, costUsd: number | null): void {
  db.insert(aiSpend).values({ actor, costUsd, createdAt: new Date() }).run();
}

// Sum of today's run costs (calendar day, server-local time), across chat
// and every Chamber's remote runs. A null cost (a run that crashed before
// the CLI reported one) counts as 0.
export function todaySpendUsd(): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const row = db
    .select({ total: sql<number>`coalesce(sum(${aiSpend.costUsd}), 0)` })
    .from(aiSpend)
    .where(gte(aiSpend.createdAt, start))
    .get();
  return row?.total ?? 0;
}
