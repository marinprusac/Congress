import type { Manifest } from "@congress/shared-types";
import { env } from "./env.js";

const base = `http://${env.HOST}:${env.PORT}`;

export const manifest: Manifest = {
  name: "deputy",
  displayName: "Deputy",
  version: "0.1.0",
  routes: {
    home: "/deputy",
    settings: "/deputy/settings",
  },
  apiBase: `${base}/api`,
  mcpUrl: `${base}/mcp`,
  healthUrl: `${base}/health`,
  // §12: a quick "message Deputy" box. Deputy keeps no run-history page or
  // widget of its own any more - see deputy.directive_run below, which the
  // Logs Chamber's own "recent-logs" widget can surface instead once the
  // owner sets up a rule for it.
  widgets: [{ id: "message", width: 2, height: 1, label: "Message Deputy" }],
  events: [
    {
      type: "deputy.directive_run",
      label: "Directive run",
      description:
        "Published with a run's full transcript every time a directive's own scheduled or manual run completes, or when a bundled chat run takes a real action (calls a tool) worth surfacing to the owner.",
      payloadFields: {
        trigger: { type: "string", description: "chat | scheduled | manual" },
        directiveId: { type: "number" },
        directiveTitle: { type: "string" },
        ok: { type: "boolean" },
        actionTaken: { type: "boolean" },
        summary: { type: "string" },
        errorMessage: { type: "string" },
        toolCallCount: { type: "number" },
        transcript: { type: "array", description: "{ toolName, input, output, error }[]" },
        costUsd: { type: "number" },
        inputTokens: { type: "number" },
        outputTokens: { type: "number" },
        durationMs: { type: "number" },
      },
    },
  ],
};
