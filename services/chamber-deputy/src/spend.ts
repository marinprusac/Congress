import { gte, sql } from "drizzle-orm";
import { db } from "./db/client.js";
import { deputySpend } from "./db/schema.js";

// One row per headless `claude` invocation, cost only - just enough for
// engine.ts's runDeputy to enforce settings.budgetCapUsd. Deputy keeps no
// other run history of its own; a completed directive run's full context
// (transcript, response, etc.) is published live to Congress's event relay
// instead (see events.ts's deputy.directive_run) for the Logs Chamber to
// durably keep, if the owner sets up a rule for it.
export function recordSpend(costUsd: number | null): void {
  db.insert(deputySpend)
    .values({ costUsd, createdAt: new Date() })
    .run();
}

// Sum of today's run costs (calendar day, server-local time). Rows with a
// null cost (a run that crashed before the CLI ever emitted its final
// `result` event) count as 0, not unknown - a failed run can't have spent
// more than whatever the CLI itself reported.
export async function todaySpendUsd(): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const row = db
    .select({ total: sql<number>`coalesce(sum(${deputySpend.costUsd}), 0)` })
    .from(deputySpend)
    .where(gte(deputySpend.createdAt, start))
    .get();
  return row?.total ?? 0;
}
