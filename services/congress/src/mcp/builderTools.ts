import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult } from "../kit/mcp.js";
import { aiUrgencySchema, RECORD_ICONS, operationSchema, SOURCE_COLORS } from "@congress/shared-types";
import { currentRunContext } from "../ai/runContext.js";
import { BUILDER_ACTOR, requestPublish } from "../ai/builder.js";
import { AskInvalidError } from "../ai/asks.js";
import { DraftError, discardDraft, getDraft, listDrafts, previewDraft, publishDraft, setDraftOps, startDraft, type Draft } from "../typeEngine/drafts.js";
import { publishEvent } from "../events.js";
import { getTypeBySlug, listTypes, listVersions, PublishError, recordCount } from "../typeEngine/store.js";
import { listConnectors } from "../connectors/runtime.js";

// /mcp/builder: every AI run may create and change record types on its own.
// Only a change that would lose data (delete_type, values a kind change
// can't convert) waits for the owner's approval through request_publish.

const OPS_GUIDE = `Ops, applied in order: create_type (a new type's first op), set_type_meta, add_field, rename_field, retire_field, restore_field, change_field_kind, set_field_options, reorder_fields, set_title_field (a text field; every type needs one), set_layout (a richtext body field), set_time_range ({ start, end, allDay? }: pairs date/datetime fields into one control), set_map_point ({ latitude, longitude, radius? }: pairs number fields into one map picker), set_actions, set_feed_rules, set_time_triggers, set_event_notifications, delete_type. set_event_notifications { notifications: [{ event, title?, body? }] } picks which of the type's events push a notification to the owner (event = created, updated, deleted, a toggle action's onEvent/offEvent, or a time trigger step/clearEvent name); every event is recorded to history regardless, and none notify unless listed. Title and body are {{payload.recordId|type|title|url}} templates, defaulting to the event label and the record title; the link is always the record. Notify only when the owner would want to be interrupted. Fields are referenced by id or current slug. Renames are free; retiring keeps the data (restore_field brings it back); change_field_kind rebuilds the table and clears values that can't convert (preview_draft counts them). Nothing is dropped by these ops. delete_type { } deletes the whole type and all its records for good (a snapshot is kept for 14 days); it must be the only op in its own draft, is refused while other types have active relation fields to it (retire those first), and never deletes anything in a connected source. It always needs the owner's approval (request_publish). Relations: kind "relation" with options.target (an existing type's slug, e.g. "person") and options.many for several; target and many are fixed once added, and a type other types link to keeps its slug. Keys: a text field with options.key "email" or "phone" holds one value per line, each unique across the type (used to find records, e.g. people). Every type has an icon, set with create_type or set_type_meta "icon"; pick one that fits what the type holds (default "file"), from exactly: ${RECORD_ICONS.join(", ")}. A type also has a colour, set with create_type or set_type_meta "color" (one of ${SOURCE_COLORS.join(", ")}); it tints the type's chips and dashboard cards, so give types that sit side by side different colours (left unset, one is derived from the slug). set_type_meta autoCreate ("never" | "corresponded" | "any") says whether connected sources may create records on their own. Bindings wire a connector's source records into a type (describe_types lists connectors and their source kinds): set_binding { connector, kind, label, fields: [{ source, target, mode: "sync" | "pull" }], lock?: { fact, equals? } (synced fields turn read-only where the fact doesn't hold), create?: { targetField } (a synced field whose value picks where new records go; "" keeps a record local), delete: "push" | "never", actions: [{ id, label, act, args, when, unless }] } adds or replaces the binding for that connector + kind; remove_binding { connector, kind } detaches its records (they stay, no longer synced). Unbound fields stay local. Pull-only for relations and readonly fields. options.hidden keeps a field out of the record screen (still stored and readable by the AI): use it for fields the owner can't edit and doesn't need to see, e.g. unread counts and flags. Feed rules also take { op: "ongoing", field: start, end } (under way now) and { op: "within_last", field, hours } (in the past few hours, newer first). A type whose bindings all lack create only gets records from its source.`;

// Drafts are owned by the run's thread; autonomous runs (no thread) share 0.
const draftThread = (): number => currentRunContext().threadId ?? 0;

function ownDraft(draftId: string): Draft {
  return getDraft(draftId);
}

// What publishing would lose: a delete, or values a kind change can't keep.
export function needsApproval(draftId: string): string | null {
  const draft = getDraft(draftId);
  if (draft.ops.some((o) => o.op === "delete_type")) return "it deletes a type";
  const p = previewDraft(draftId);
  const lost = p.warnings.filter((w) => w.count > 0);
  if (lost.length) return `records would lose values (${lost.map((w) => `${w.label}: ${w.count}`).join(", ")})`;
  return null;
}

async function guarded(fn: () => unknown) {
  try {
    return mcpTextResult(await fn());
  } catch (err) {
    if (err instanceof DraftError || err instanceof PublishError) return mcpTextResult({ error: "invalid", message: err.message });
    if (err instanceof DraftError || err instanceof AskInvalidError) return mcpTextResult({ error: "invalid", message: err.message });
    throw err;
  }
}

function draftState(draft: Draft) {
  const preview = previewDraft(draft.id);
  return {
    draftId: draft.id,
    slug: draft.slug,
    rollbackTo: draft.rollbackTo,
    opCount: draft.ops.length,
    errors: preview.errors,
    changes: preview.changes.map((c) => c.text),
    definition: preview.definition,
  };
}

export function registerBuilderTools(server: McpServer) {
  server.registerTool(
    "builder_status",
    {
      title: "Builder Status",
      description: "Your open drafts in this thread.",
      inputSchema: {},
    },
    () =>
      guarded(() => ({
        drafts: listDrafts({ threadId: draftThread(), openOnly: true }).map((d) => ({ draftId: d.id, slug: d.slug, opCount: d.ops.length, stale: d.stale })),
      }))
  );

  server.registerTool(
    "describe_types",
    {
      title: "Describe Types",
      description: "Every record type, hidden ones included: full definition (fields with ids, actions, time triggers, bindings), version, record count; plus the running connectors and their source kinds (fields, facts) for bindings.",
      inputSchema: {},
    },
    () =>
      guarded(() => {
        const all = listTypes({ includeHidden: true });
        const types = all.map((t) => ({
          version: t.version,
          recordCount: recordCount(t.id),
          linkedFrom: all.flatMap((o) =>
            o.definition.fields
              .filter((f) => !f.retired && f.kind === "relation" && f.options.target === t.definition.slug)
              .map((f) => `${o.definition.slug}.${f.slug}`)
          ),
          definition: t.definition,
        }));
        const connectors = listConnectors().map((c) => ({ name: c.name, label: c.label, canWrite: Boolean(c.push), source: c.source }));
        return { types, connectors };
      })
  );

  server.registerTool(
    "list_type_versions",
    {
      title: "List Type Versions",
      description: "A type's version history, newest first, each with what changed. Use a version number with start_draft's rollbackTo.",
      inputSchema: { slug: z.string() },
    },
    ({ slug }) =>
      guarded(() => {
        const type = getTypeBySlug(slug);
        if (!type) throw new DraftError(`no type "${slug}"`);
        return listVersions(type.id).map((v) => ({ version: v.version, actor: v.actor, createdAt: v.createdAt, changes: v.changes.map((c) => c.text) }));
      })
  );

  server.registerTool(
    "start_draft",
    {
      title: "Start Draft",
      description: `Open a draft: for a new type (no slug), for changes to an existing type (slug), or to roll a type back to an earlier version (slug + rollbackTo). Reuses this thread's open draft for that type. ${OPS_GUIDE}`,
      inputSchema: {
        slug: z.string().optional().describe("The existing type to change; omit for a new type."),
        rollbackTo: z.number().int().positive().optional().describe("Roll the type back to this version (fields added since come back retired)."),
      },
    },
    ({ slug, rollbackTo }) => guarded(() => draftState(startDraft({ threadId: draftThread(), slug, rollbackTo })))
  );

  server.registerTool(
    "set_draft_ops",
    {
      title: "Set Draft Ops",
      description: `Append ops to a draft (or replace all of them). Returns the resulting definition, any errors, and the changes in words. ${OPS_GUIDE}`,
      inputSchema: {
        draftId: z.string(),
        ops: z.array(operationSchema).max(50),
        mode: z.enum(["append", "replace"]).default("append"),
      },
    },
    ({ draftId, ops, mode }) =>
      guarded(() => {
        ownDraft(draftId);
        return draftState(setDraftOps(draftId, ops, mode));
      })
  );

  server.registerTool(
    "preview_draft",
    {
      title: "Preview Draft",
      description:
        "Exactly what publishing the draft would do right now: the changes in words, the SQL steps, whether the table is rebuilt, warnings with how many records lose a value, blockers, and errors. Nothing is written. A draft with warnings (values lost) or a delete_type needs request_publish; anything else publish_draft publishes directly.",
      inputSchema: { draftId: z.string() },
    },
    ({ draftId }) =>
      guarded(() => {
        ownDraft(draftId);
        const p = previewDraft(draftId);
        return {
          errors: p.errors,
          blockers: p.blockers,
          warnings: p.warnings,
          rebuild: p.plan?.rebuild ?? false,
          steps: p.plan?.steps ?? [],
          changes: p.changes.map((c) => c.text),
        };
      })
  );

  server.registerTool(
    "discard_draft",
    {
      title: "Discard Draft",
      description: "Throw a draft away.",
      inputSchema: { draftId: z.string() },
    },
    ({ draftId }) =>
      guarded(() => {
        ownDraft(draftId);
        return { ok: true, state: discardDraft(draftId).state };
      })
  );

  server.registerTool(
    "request_publish",
    {
      title: "Request Publish",
      description:
        "Ask the owner to approve publishing a draft that would lose data (delete_type, or warnings in preview_draft). They see its changes and warnings; on approval Congress publishes exactly that draft and tells you the result in a follow-up run. Changing the draft afterwards voids the approval.",
      inputSchema: {
        draftId: z.string(),
        title: z.string().min(1).max(120).describe('Short headline, e.g. "Create the Book type".'),
        summary: z.string().min(1).max(2000).describe("What it does and why, in Markdown; mention any data a warning says will be lost."),
        urgency: aiUrgencySchema.default("quiet"),
      },
    },
    ({ draftId, title, summary, urgency }) =>
      guarded(async () => {
        ownDraft(draftId);
        const { message, delivery } = await requestPublish({ draftId, title, summary, urgency }, currentRunContext());
        return { ok: true, messageId: message.id, delivery };
      })
  );

  server.registerTool(
    "publish_draft",
    {
      title: "Publish Draft",
      description:
        "Publish a draft now, without asking: create a type, add/rename/retire fields, change bindings, triggers, roll back. Refused when it would lose data (delete_type, or values a kind change can't convert); use request_publish for those. Keep types general (not tied to one provider), and tell the owner what you built when it's relevant to them.",
      inputSchema: { draftId: z.string() },
    },
    ({ draftId }) =>
      guarded(() => {
        ownDraft(draftId);
        const reason = needsApproval(draftId);
        if (reason) throw new DraftError(`needs the owner's approval: ${reason}. Use request_publish.`);
        const { type } = publishDraft(draftId, BUILDER_ACTOR);
        publishEvent({
          chamber: "congress",
          type: "congress.type_published",
          actor: "congress",
          payload: { slug: type.definition.slug, label: type.definition.label, version: type.version, summary: "Published by the AI" },
        });
        return { ok: true, slug: type.definition.slug, version: type.version };
      })
  );
}
