import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RecordValue, TypeDefinition } from "@congress/shared-types";
import { buildChipToken } from "@congress/shared-types";
import { mcpTextResult } from "@congress/chamber-kit";
import { listTypes, getTypeBySlug, type StoredType } from "./store.js";
import { activeFields } from "./operations.js";
import { recordInputSchema } from "./codec.js";
import {
  createRecord,
  deleteRecord,
  getRecord,
  listRecords,
  NAMESPACE,
  rangeFields,
  relatedRecords,
  RecordConflictError,
  RecordLockedError,
  RecordNotFoundError,
  RecordValidationError,
  typeOfRecord,
  updateRecord,
} from "./records.js";
import { bindingTargets, runBindingAction, withBinding } from "./bindings/runtime.js";
import { typeEngineSource } from "./source.js";
import { lookupOrCreate } from "./lookups.js";
import { FileTooLargeError, storeUpload } from "./files.js";
import { env } from "../env.js";

// The "types" MCP server: generic tools plus list/search/get/create/update/
// delete per visible type, rebuilt from live definitions on every request.

function plural(slug: string): string {
  return slug.endsWith("s") ? slug : `${slug}s`;
}

function describeFields(def: TypeDefinition): string {
  return activeFields(def)
    .map((f) => {
      const extra =
        f.kind === "enum"
          ? ` (one of: ${(f.options.options ?? []).map((o) => o.value).join(", ")})`
          : f.kind === "relation"
            ? ` (${f.options.many ? "ids of" : "id of a"} ${f.options.target} record${f.options.many ? "s" : ""}; find them with search_${plural(f.options.target ?? "")})`
            : f.kind === "datetime"
              ? " (ISO 8601)"
              : f.kind === "date"
                ? " (YYYY-MM-DD, a calendar day)"
                : f.kind === "file"
                  ? " (write the id upload_file returns)"
                  : f.kind === "richtext"
                    ? " (markdown; may contain [[exhibit:chamber:id|Name]] tokens)"
                    : f.options.key
                      ? ` (${f.options.key === "email" ? "emails" : "phone numbers"}, one per line; a lookup key)`
                      : "";
      const flags = `${f.options.required ? ", required" : ""}${f.options.readonly ? ", read-only" : ""}`;
      return `${f.slug}: ${f.kind}${flags}${extra}`;
    })
    .join("; ");
}

function withChip<T extends { id: string; type: string; values: Record<string, unknown> }>(t: StoredType, record: T) {
  const titleField = t.definition.fields.find((f) => f.id === t.definition.titleField);
  const name = (titleField && String(record.values[titleField.slug] ?? "")) || t.definition.label;
  return { ...record, token: buildChipToken({ chamber: NAMESPACE, id: record.id, name }) };
}

async function guarded(fn: () => unknown) {
  try {
    return mcpTextResult(await fn());
  } catch (err) {
    if (err instanceof RecordNotFoundError) return mcpTextResult({ error: "not_found", message: err.message });
    if (err instanceof RecordValidationError) return mcpTextResult({ error: "invalid", issues: err.issues });
    if (err instanceof RecordConflictError) return mcpTextResult({ error: "conflict", field: err.field, message: err.message });
    if (err instanceof RecordLockedError) return mcpTextResult({ error: "locked", fields: err.fields, message: err.message });
    throw err;
  }
}

export function registerTypeTools(server: McpServer): void {
  const types = listTypes();

  server.registerTool(
    "list_types",
    {
      title: "List Types",
      description: "Every kind of exhibit Congress stores itself (notes, ...) with its fields. Each has its own list/search/get/create/update/delete tools here.",
      inputSchema: {},
    },
    async () => mcpTextResult(types.map((t) => ({ slug: t.definition.slug, label: t.definition.label, fields: describeFields(t.definition) })))
  );

  for (const t of types) {
    const def = t.definition;
    const slug = def.slug;
    const label = def.label.toLowerCase();
    const fields = describeFields(def);
    const refHint = "Records are exhibits: reference one elsewhere with its `token`; use Congress's own tools for Connections.";

    const range = rangeFields(def);
    const when = range ? `${range.start.label.toLowerCase()}` : "date";
    server.registerTool(
      `list_${plural(slug)}`,
      {
        title: `List ${def.pluralLabel}`,
        description: `List ${def.pluralLabel.toLowerCase()}, most recently updated first${range ? ", or soonest first within from/to" : ""}. Fields: ${fields}.`,
        inputSchema: {
          limit: z.number().int().min(1).max(200).optional(),
          offset: z.number().int().min(0).optional(),
          from: z.string().optional().describe(`ISO time: only ones whose ${when} range reaches past it`),
          to: z.string().optional().describe(`ISO time: only ones whose ${when} is before it`),
        },
      },
      (args: { limit?: number; offset?: number; from?: string; to?: string }) =>
        guarded(() => listRecords(slug, { limit: args.limit ?? 50, offset: args.offset, from: args.from, to: args.to }).map((r) => withChip(t, r)))
    );

    // Bindings: where new records can go, and the source's actions.
    for (const target of def.bindings.filter((b) => b.create)) {
      const f = def.fields.find((x) => x.id === target.create!.targetField);
      server.registerTool(
        `list_${slug}_destinations`,
        {
          title: `${def.label} destinations`,
          description: `Values for a ${label}'s "${f?.slug}" field that put it in ${target.label} (empty keeps it local only). Changing it later moves the ${label}.`,
          inputSchema: {},
        },
        () => guarded(() => bindingTargets(t))
      );
      break;
    }
    for (const b of def.bindings) {
      for (const a of b.actions) {
        server.registerTool(
          `${a.id}_${slug}`,
          {
            title: `${a.label} ${def.label}`,
            description: `${a.label} a ${label} in ${b.label} (this reaches ${b.label}, and anyone it notifies). Only offered on some records: get_${slug} lists a record's binding.actions.`,
            inputSchema: { id: z.string().min(1) },
          },
          ({ id }) => guarded(() => runBindingAction(id, a.id).then((r) => withChip(t, r)))
        );
      }
    }

    server.registerTool(
      `search_${plural(slug)}`,
      {
        title: `Search ${def.pluralLabel}`,
        description: `Search ${def.pluralLabel.toLowerCase()} by their text.`,
        inputSchema: { query: z.string().min(1) },
      },
      ({ query }) =>
        guarded(() =>
          typeEngineSource
            .search(query)
            .filter((r) => r.type === slug)
            .map((r) => ({ ...r, token: buildChipToken({ chamber: NAMESPACE, id: r.id, name: r.name }) }))
        )
    );

    server.registerTool(
      `get_${slug}`,
      { title: `Get ${def.label}`, description: `Get one ${label} by id. ${refHint}`, inputSchema: { id: z.string().min(1) } },
      ({ id }) =>
        guarded(() => {
          const record = getRecord(id);
          if (!record || record.type !== slug) throw new RecordNotFoundError(`no ${label} ${id}`);
          const related = (relatedRecords(id) ?? []).map((g) => ({
            from: `${g.typeLabel} · ${g.fieldLabel}`,
            total: g.total,
            records: g.records.map((r) => ({ id: r.id, token: buildChipToken({ chamber: NAMESPACE, id: r.id, name: r.name }) })),
          }));
          return { ...withChip(t, withBinding(record)), ...(related.length ? { linkedFrom: related } : {}) };
        })
    );

    server.registerTool(
      `create_${slug}`,
      {
        title: `Create ${def.label}`,
        description: `Create a ${label}. Fields: ${fields}. ${refHint}`,
        inputSchema: recordInputSchema(def, "create").shape,
      },
      (values) => guarded(() => withChip(t, createRecord(slug, values, { actor: "congress" })))
    );

    server.registerTool(
      `update_${slug}`,
      {
        title: `Update ${def.label}`,
        description: `Change some fields of a ${label}; fields you leave out stay as they are. Fields: ${fields}.`,
        inputSchema: { id: z.string().min(1), ...recordInputSchema(def, "patch").shape },
      },
      ({ id, ...values }) =>
        guarded(() => {
          if (typeOfRecord(id)?.definition.slug !== slug) throw new RecordNotFoundError(`no ${label} ${id}`);
          return withChip(t, updateRecord(id, values, { actor: "congress" }));
        })
    );

    const keyKinds = [...new Set(activeFields(def).flatMap((f) => (f.kind === "text" && f.options.key ? [f.options.key] : [])))];
    if (keyKinds.length) {
      server.registerTool(
        `find_or_create_${slug}`,
        {
          title: `Find or Create ${def.label}`,
          description: `Find a ${label} by ${keyKinds.join(" or ")}, or create one with these values if none matches. Prefer this over create_${slug} so there are no duplicates.`,
          inputSchema: {
            ...(keyKinds.includes("email") ? { email: z.string().optional() } : {}),
            ...(keyKinds.includes("phone") ? { phone: z.string().optional() } : {}),
            values: recordInputSchema(def, "patch").optional(),
          },
        },
        ({ email, phone, values }: { email?: string; phone?: string; values?: Record<string, RecordValue> }) =>
          guarded(() => {
            const keys = [
              ...(email ? [{ kind: "email" as const, value: email }] : []),
              ...(phone ? [{ kind: "phone" as const, value: phone }] : []),
            ];
            const res = lookupOrCreate(slug, { keys, values, evidence: "owner", actor: "congress" });
            if (!res.id) return res;
            return { created: res.created, ...withChip(t, getRecord(res.id)!) };
          })
      );
    }

    server.registerTool(
      `delete_${slug}`,
      { title: `Delete ${def.label}`, description: `Delete a ${label}. This can't be undone.`, inputSchema: { id: z.string().min(1) } },
      ({ id }) =>
        guarded(() => {
          if (typeOfRecord(id)?.definition.slug !== slug) throw new RecordNotFoundError(`no ${label} ${id}`);
          deleteRecord(id, { actor: "congress" });
          return { ok: true, id };
        })
    );
  }

  server.registerTool(
    "describe_type",
    { title: "Describe Type", description: "One type's full definition.", inputSchema: { slug: z.string().min(1) } },
    ({ slug }) => guarded(() => getTypeBySlug(slug)?.definition ?? { error: "not_found" })
  );

  server.registerTool(
    "upload_file",
    {
      title: "Upload File",
      description: `Store a file (base64, at most ${Math.floor(env.MAX_UPLOAD_BYTES / 1024 / 1024)} MB) and get its id, then set that id as a file field's value (e.g. create_document's "file").`,
      inputSchema: {
        filename: z.string().min(1).max(200),
        mimeType: z.string().default("application/octet-stream"),
        contentBase64: z.string().min(1),
      },
    },
    ({ filename, mimeType, contentBase64 }) =>
      guarded(async () => {
        const bytes = Buffer.from(contentBase64, "base64");
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(bytes));
            controller.close();
          },
        });
        try {
          return await storeUpload(body, { name: filename, mime: mimeType });
        } catch (err) {
          if (err instanceof FileTooLargeError) return { error: "file_too_large", maxBytes: err.maxBytes };
          throw err;
        }
      })
  );
}
