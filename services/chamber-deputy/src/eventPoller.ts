import { eq } from "drizzle-orm";
import { eventLogResponseSchema, type EventLogEntry, type EventLogResponse } from "@congress/shared-types";
import { db } from "./db/client.js";
import { pollerState } from "./db/schema.js";
import { env } from "./env.js";
import { getSettings } from "./settings.js";
import { enqueue } from "./jobQueue.js";
import { runDeputy } from "./engine.js";

// How often this Chamber checks Congress's event log - independent of the
// (much longer, owner-configurable) checkup interval itself. A short,
// code-owned tick so an urgent event is never left waiting more than this
// long before preempting the next scheduled checkup (docs/
// deputy-chamber-plan.md §6).
const TICK_INTERVAL_MS = 20_000;
const POLLER_ID = 1;

interface PollerState {
  lastUrgentEventId: number;
  lastCheckupEventId: number;
  lastCheckupAt: Date | null;
}

function getState(): PollerState {
  const row = db.select().from(pollerState).where(eq(pollerState.id, POLLER_ID)).get();
  if (!row) return { lastUrgentEventId: 0, lastCheckupEventId: 0, lastCheckupAt: null };
  return { lastUrgentEventId: row.lastUrgentEventId, lastCheckupEventId: row.lastCheckupEventId, lastCheckupAt: row.lastCheckupAt };
}

function setState(patch: Partial<PollerState>): void {
  const existing = db.select().from(pollerState).where(eq(pollerState.id, POLLER_ID)).get();
  if (existing) {
    db.update(pollerState).set(patch).where(eq(pollerState.id, POLLER_ID)).run();
  } else {
    db.insert(pollerState)
      .values({ id: POLLER_ID, lastUrgentEventId: 0, lastCheckupEventId: 0, lastCheckupAt: null, ...patch })
      .run();
  }
}

async function fetchEventsSince(since: number): Promise<EventLogResponse> {
  const res = await fetch(`${env.CAPITOL_URL}/congress/events?since=${since}`, {
    headers: { "X-Congress-Internal-Token": env.CONGRESS_INTERNAL_TOKEN },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Congress returned ${res.status}`);
  return eventLogResponseSchema.parse(await res.json());
}

function isUrgent(event: EventLogEntry): boolean {
  return event.payload?.priority === "urgent";
}

// Two cursors advancing off one fetched batch (see db/schema.ts's
// pollerState comment): `lastUrgentEventId` tracks what's been scanned for
// an urgent preemption, `lastCheckupEventId` tracks what's been folded into
// a periodic checkup's own prompt context. Fetching since the older of the
// two on every tick means neither cursor ever skips an event the other
// hasn't consumed yet.
async function tick(): Promise<void> {
  const settings = await getSettings();
  if (settings.paused) return;

  const state = getState();
  const since = Math.min(state.lastUrgentEventId, state.lastCheckupEventId);

  let batch: EventLogResponse;
  try {
    batch = await fetchEventsSince(since);
  } catch (err) {
    console.warn(`Deputy event poll failed: ${(err as Error).message}`);
    return;
  }

  const urgentEvents = batch.events.filter((e) => e.id > state.lastUrgentEventId && isUrgent(e));
  for (const event of urgentEvents) {
    void enqueue(() => runDeputy({ trigger: "urgent", events: [event] })).catch((err) =>
      console.warn(`Deputy urgent run failed: ${(err as Error).message}`)
    );
  }
  if (batch.events.length > 0) setState({ lastUrgentEventId: batch.cursor });

  const checkupDue = !state.lastCheckupAt || Date.now() - state.lastCheckupAt.getTime() >= settings.checkupIntervalMs;
  if (checkupDue) {
    const checkupEvents = batch.events.filter((e) => e.id > state.lastCheckupEventId);
    void enqueue(() => runDeputy({ trigger: "periodic", events: checkupEvents })).catch((err) =>
      console.warn(`Deputy periodic checkup failed: ${(err as Error).message}`)
    );
    setState({ lastCheckupEventId: batch.cursor, lastCheckupAt: new Date() });
  }
}

let tickInterval: ReturnType<typeof setInterval> | undefined;

export function startEventPoller(): void {
  void tick();
  tickInterval = setInterval(() => void tick(), TICK_INTERVAL_MS);
}

export function stopEventPoller(): void {
  if (tickInterval) clearInterval(tickInterval);
}
