import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult } from "@congress/chamber-kit";
import { aiUrgencySchema, operationSchema } from "@congress/shared-types";
import { currentRunContext } from "../ai/runContext.js";
import { activeGrant, requestPublish } from "../ai/builder.js";
import { AskInvalidError } from "../ai/asks.js";
import { DraftError, discardDraft, getDraft, listDrafts, previewDraft, setDraftOps, startDraft, type Draft } from "../typeEngine/drafts.js";
import { getTypeBySlug, listTypes, listVersions, recordCount } from "../typeEngine/store.js";
import { listConnectors } from "../connectors/runtime.js";

// /mcp/builder: drafting exhibit-type changes, only in a thread the owner
// granted builder mode (re-checked on every call; a grant can end mid-run).

const OPS_GUIDE = `Ops, applied in order: create_type (a new type's first op), set_type_meta, add_field, rename_field, retire_field, restore_field, change_field_kind, set_field_options, reorder_fields, set_title_field (a text field; every type needs one), set_layout (a richtext body field), set_time_range ({ start, end, allDay? }: pairs date/datetime fields into one control and the feed's time), set_actions, set_feed_rules, set_time_triggers. Fields are referenced by id or current slug. Renames are free; retiring keeps the data (restore_field brings it back); change_field_kind rebuilds the table and clears values that can't convert (preview_draft counts them). Nothing is ever dropped. Relations: kind "relation" with options.target (an existing type's slug, e.g. "person") and options.many for several; target and many are fixed once added, and a type other types link to keeps its slug. Keys: a text field with options.key "email" or "phone" holds one value per line, each unique across the type (used to find records, e.g. people). set_type_meta autoCreate ("never" | "corresponded" | "any") says whether connected sources may create records on their own. Bindings wire a connector's source records into a type (describe_types lists connectors and their source kinds): set_binding { connector, kind, label, fields: [{ source, target, mode: "sync" | "pull" }], lock?: { fact, equals? } (synced fields turn read-only where the fact doesn't hold), create?: { targetField } (a synced field whose value picks where new records go; "" keeps a record local), delete: "push" | "never", actions: [{ id, label, act, args, when, unless }] } adds or replaces the binding for that connector + kind; remove_binding { connector, kind } detaches its records (they stay, no longer synced). Unbound fields stay local. Pull-only for relations and readonly fields. Feed rules also take { op: "ongoing", field: start, end } (under way now).`;

class NotGranted extends Error {}

function threadWithGrant(): number {
  const { threadId } = currentRunContext();
  if (!activeGrant(threadId)) throw new NotGranted();
  return threadId!;
}

function ownDraft(draftId: string): Draft {
  const draft = getDraft(draftId);
  if (draft.threadId !== threadWithGrant()) throw new DraftError("That draft belongs to another thread.");
  return draft;
}

async function guarded(fn: () => unknown) {
  try {
    return mcpTextResult(await fn());
  } catch (err) {
    if (err instanceof NotGranted) {
      return mcpTextResult({ error: "not_granted", message: "Builder mode isn't granted in this thread (or it ended). Ask with request_builder_mode." });
    }
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

// Every tool is always registered (a run's tool list is fixed at its start) and
// refuses without a grant; runs only get this server while their thread has one.
export function registerBuilderTools(server: McpServer) {
  server.registerTool(
    "builder_status",
    {
      title: "Builder Status",
      description: "Whether builder mode is granted in this thread, until when, and your open drafts.",
      inputSchema: {},
    },
    () =>
      guarded(() => {
        const g = activeGrant(currentRunContext().threadId);
        const drafts = g ? listDrafts({ threadId: g.threadId, openOnly: true }).map((d) => ({ draftId: d.id, slug: d.slug, opCount: d.ops.length, stale: d.stale })) : [];
        return { granted: Boolean(g), until: g?.expiresAt.toISOString() ?? null, drafts };
      })
  );

  server.registerTool(
    "describe_types",
    {
      title: "Describe Types",
      description: "Every exhibit type, hidden ones included: full definition (fields with ids, feed rules, actions, time triggers, bindings), version, record count, and whether it's premade; plus the running connectors and their source kinds (fields, facts) for bindings.",
      inputSchema: {},
    },
    () =>
      guarded(() => {
        threadWithGrant();
        const all = listTypes({ includeHidden: true });
        const types = all.map((t) => ({
          version: t.version,
          origin: t.origin,
          customized: t.forked,
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
        threadWithGrant();
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
    ({ slug, rollbackTo }) => guarded(() => draftState(startDraft({ threadId: threadWithGrant(), slug, rollbackTo })))
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
        "Exactly what publishing the draft would do right now: the changes in words, the SQL steps, whether the table is rebuilt, warnings with how many records lose a value, blockers, and errors. Nothing is written. Tell the owner about warnings before asking to publish.",
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
        "Ask the owner to approve publishing a draft. They see its changes and warnings; on approval Congress publishes exactly that draft and tells you the result in a follow-up run. Changing the draft afterwards voids the approval.",
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
}
