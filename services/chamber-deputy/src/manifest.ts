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
  // Views are only genuine screens (see shared-types' manifestViewSchema) -
  // this Chamber's exhibits reach the home feed and Search on their own.
  // exhibitTypes is what the home screen's "+" can create here.
  views: [],
  exhibitTypes: [{ type: "directive", label: "Directive", createPath: "/directives/new" }],
  events: [
    {
      type: "deputy.directive_run",
      label: "Directive run",
      description: "Published with a run's full transcript every time a directive's scheduled, event-triggered or manual run completes.",
      payloadFields: {
        trigger: { type: "string", description: "scheduled | event | manual" },
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
