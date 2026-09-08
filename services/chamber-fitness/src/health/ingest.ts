import { eq } from "drizzle-orm";
import type { HealthIngestRequest, HealthIngestResult } from "../types.js";
import { db } from "../db/client.js";
import { healthMetrics } from "../db/schema.js";
import { getSettings } from "../settings.js";
import { publishEvent } from "../events.js";
import { findExistingMetric } from "../healthMetrics.js";

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

function parseDate(value: string): Date {
  return new Date(value);
}

// Upserts each sample by (metricType, startDate, endDate) - Shortcuts has no
// stable per-sample UUID to hand us and will re-send overlapping recent
// history on every run, so a resend must update in place rather than
// duplicate. Publishes fitness.health_metric_received only if at least one
// row was actually new or changed, not on a byte-identical resend.
export async function ingestSamples(request: HealthIngestRequest): Promise<HealthIngestResult> {
  const errors: HealthIngestResult["errors"] = [];
  let accepted = 0;
  let changed = false;
  const now = new Date();

  for (const [index, sample] of request.samples.entries()) {
    const startDate = parseDate(sample.startDate);
    const endDate = sample.endDate ? parseDate(sample.endDate) : startDate;
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      errors.push({ index, message: "invalid_date" });
      continue;
    }

    const existing = findExistingMetric(sample.metricType, startDate, endDate);
    const sourceName = sample.sourceName ?? null;

    // Apple's Sleep Analysis samples are category samples (asleep/awake/...),
    // not quantity samples - there's no meaningful numeric reading for a
    // Shortcut to hand us here, only the interval itself. Deriving the
    // duration server-side from (endDate - startDate) means the Shortcut
    // only needs to supply the raw sample's start/end (no extra "Get Time
    // Between Dates" step), and keeps this value consistent by construction
    // with getLatestSleepAsleep's own night-sum, which sums these same
    // intervals rather than trusting a client-sent number.
    const isSleep = sample.metricType === "sleepAsleep";
    const value = isSleep ? (endDate.getTime() - startDate.getTime()) / 1000 : sample.value;
    const unit = isSleep ? "s" : sample.unit;

    if (existing) {
      if (existing.value !== value || existing.unit !== unit || existing.sourceName !== sourceName) {
        changed = true;
      }
      db.update(healthMetrics).set({ value, unit, sourceName }).where(eq(healthMetrics.id, existing.id)).run();
    } else {
      db.insert(healthMetrics)
        .values({ metricType: sample.metricType, value, unit, startDate, endDate, sourceName, createdAt: now })
        .run();
      changed = true;
    }
    accepted++;
  }

  if (changed) {
    void publishEvent({ type: "fitness.health_metric_received", payload: { count: accepted } });
  }

  return { accepted, rejected: errors.length, errors };
}
