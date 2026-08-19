import { priorityLevelSchema, type EventDelivery, type PriorityLevel } from "@congress/shared-types";
import { listEnabledLogRulesForTrigger, markLogRuleFired } from "./logRules.js";
import { pushNotification } from "./notifications.js";
import { recordHistory, priorityRankFor } from "./eventHistory.js";

// Reads a dotted path ("a.b.c") out of a plain object, returning undefined
// for any missing/non-object segment - used by the condition check,
// priority extraction, and template interpolation below.
function getPath(payload: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), payload);
}

// v1's only equality condition shape: an optional single-field exact-match
// filter beyond the event type match already selecting this rule. No
// expression language by design - see logRules table's own comment.
function conditionMatches(rule: { conditionField: string | null; conditionEquals: string | null }, payload: Record<string, unknown>): boolean {
  if (!rule.conditionField) return true;
  const value = getPath(payload, rule.conditionField);
  return String(value ?? "") === (rule.conditionEquals ?? "");
}

// payload.priority is a convention (PRIORITY_LEVELS, shared-types), not
// enforced by Congress - anything missing or unrecognized defaults to
// "normal" rather than rejecting the event.
function priorityOf(payload: Record<string, unknown>): PriorityLevel {
  const parsed = priorityLevelSchema.safeParse(payload.priority);
  return parsed.success ? parsed.data : "normal";
}

// ">=" is deliberately the only comparison minPriority supports - see
// logRules table's own comment.
function minPriorityMatches(rule: { minPriority: PriorityLevel | null }, priority: PriorityLevel): boolean {
  if (!rule.minPriority) return true;
  return priorityRankFor(priority) >= priorityRankFor(rule.minPriority);
}

// Plain {{payload.x}}/{{payload.a.b}} interpolation - no templating library,
// no arbitrary expressions, just a dotted-path lookup against the firing
// event's own payload.
function interpolate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{\s*payload\.([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, path: string) => {
    const value = getPath(payload, path);
    return value === undefined || value === null ? "" : String(value);
  });
}

async function runRule(rule: ReturnType<typeof listEnabledLogRulesForTrigger>[number], event: EventDelivery): Promise<void> {
  if (!conditionMatches(rule, event.payload)) return;
  const priority = priorityOf(event.payload);
  if (!minPriorityMatches(rule, priority)) return;

  if (rule.recordToHistory) {
    recordHistory({
      ruleId: rule.id,
      chamber: event.chamber,
      type: event.type,
      priority,
      payload: event.payload,
      occurredAt: new Date(event.occurredAt),
      retentionMs: rule.historyRetentionMs,
    });
  }

  if (rule.notify) {
    // The dedupe key template is an optional field the owner rarely fills
    // in - default to a key scoped to this rule so repeat firings still
    // update the one notification in place instead of colliding with
    // another rule's own default-keyed notification for the same chamber.
    const dedupeKey = rule.notifyDedupeKeyTemplate ? interpolate(rule.notifyDedupeKeyTemplate, event.payload) : `rule-${rule.id}`;
    const title = rule.notifyTitleTemplate ? interpolate(rule.notifyTitleTemplate, event.payload) : rule.title;
    const body = rule.notifyBodyTemplate ? interpolate(rule.notifyBodyTemplate, event.payload) : undefined;
    const chamberUrl = rule.notifyUrlTemplate ? interpolate(rule.notifyUrlTemplate, event.payload) : undefined;
    // Preserve the original emitting chamber's identity (e.g. "tasks") so
    // the notification bell attributes/icons it correctly - this Chamber
    // is just the one deciding whether/what to push, not the source.
    pushNotification({ chamber: event.chamber, dedupeKey, title, body, chamberUrl });
  }

  await markLogRuleFired(rule.id);
}

// Handed to mountEventReceiveRoute (@congress/chamber-kit) - runs every
// enabled rule whose triggerEventType matches this one delivered event,
// same logic the old poll loop ran per batched event, just invoked directly
// per push instead of on a 30s tick.
export async function handleReceivedEvent(event: EventDelivery): Promise<void> {
  const matches = listEnabledLogRulesForTrigger(event.type);
  for (const rule of matches) {
    try {
      await runRule(rule, event);
    } catch (err) {
      console.warn(`Log rule ${rule.id} failed on event ${event.chamber}.${event.type}: ${(err as Error).message}`);
    }
  }
}
