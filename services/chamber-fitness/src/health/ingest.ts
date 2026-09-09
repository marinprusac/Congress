import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { healthMetrics } from "../db/schema.js";
import { getSettings } from "../settings.js";
import { publishEvent } from "../events.js";
import { findExistingMetric } from "../healthMetrics.js";
import type { NormalizedHealthSample } from "./normalize.js";

// Deliberate deviation from this codebase's usual auth split (Congress-side
// requireSession / X-Congress-Internal-Token, or reachability-only trust): a
// Shortcuts automation can present neither a session cookie nor the shared
// internal token, so this route validates its own bearer-style secret,
// stored in this Chamber's own settings row and rotatable from its own
// Settings page with no redeploy. Safe only because Congress forwards this
// one path through unauthenticated by design (see congress/src/server.ts) -
// chamber-fitness itself is unreachable except through that forward.
export async function isValidIngestToken(headerValue: string | undefined): Promise<boolean> {
  if (!headerValue) return false;
  const { healthIngestToken } = await getSettings();
  return !!healthIngestToken && headerValue === healthIngestToken;
}

// Upserts each sample by (metricType, startDate, endDate) - the export has
// no stable per-sample id to hand us and will re-send overlapping recent
// history on every run, so a resend must update in place rather than
// duplicate. Publishes fitness.health_metric_received only if at least one
// row was actually new or changed, not on a byte-identical resend. Samples
// are expected already normalized (health/normalize.ts) - this function
// only knows about this Chamber's own storage shape, not the export's wire
// format.
export async function ingestSamples(samples: NormalizedHealthSample[]): Promise<{ accepted: number }> {
  let accepted = 0;
  let changed = false;
  const now = new Date();

  for (const sample of samples) {
    const existing = findExistingMetric(sample.metricType, sample.startDate, sample.endDate);

    if (existing) {
      if (existing.value !== sample.value || existing.unit !== sample.unit || existing.sourceName !== sample.sourceName) {
        changed = true;
      }
      db.update(healthMetrics)
        .set({ value: sample.value, unit: sample.unit, sourceName: sample.sourceName })
        .where(eq(healthMetrics.id, existing.id))
        .run();
    } else {
      db.insert(healthMetrics)
        .values({
          metricType: sample.metricType,
          value: sample.value,
          unit: sample.unit,
          startDate: sample.startDate,
          endDate: sample.endDate,
          sourceName: sample.sourceName,
          createdAt: now,
        })
        .run();
      changed = true;
    }
    accepted++;
  }

  if (changed) {
    void publishEvent({ type: "fitness.health_metric_received", payload: { count: accepted } });
  }

  return { accepted };
}
