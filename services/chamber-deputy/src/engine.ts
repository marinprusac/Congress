import { fetchCongressAiSettings, runCongressAi } from "@congress/chamber-kit";
import type { AiRunResult } from "@congress/shared-types";
import { env } from "./env.js";
import { buildDirectivePrompt, type PromptContext } from "./promptAssembly.js";
import { publishEvent } from "./events.js";
import type { DeputyRunTrigger, DirectiveSummary } from "./types.js";

// Deputy no longer spawns `claude` itself - the engine, its concurrency-1
// queue and the shared budget/pause guardrails all live in Congress now
// (services/congress/src/ai/). A directive run is just a prompt handed to
// POST /congress/ai/run, tagged so Deputy's own progress rings can find it
// on Congress's run stream.

// Published on every completed directive run, whether or not it took action
// or succeeded - whether any of this is worth keeping or notifying on is
// entirely the owner's Logs rule's call (recordToHistory/notify).
export async function reportRun(trigger: DeputyRunTrigger, result: AiRunResult, directive: DirectiveSummary): Promise<void> {
  await publishEvent({
    type: "deputy.directive_run",
    actor: "deputy",
    payload: {
      trigger,
      directiveId: directive.id,
      directiveTitle: directive.title,
      ok: result.ok,
      actionTaken: result.transcript.length > 0,
      summary: result.response,
      errorMessage: result.errorMessage,
      toolCallCount: result.transcript.length,
      transcript: result.transcript,
      costUsd: result.costUsd,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs: result.durationMs,
    },
  });
}

// A refused run (AI paused or over budget) never ran at all, so there is
// nothing to report - it isn't a failed run of this directive.
export async function runDirective(ctx: PromptContext): Promise<AiRunResult> {
  const result = await runCongressAi(env.CAPITOL_URL, env.CONGRESS_INTERNAL_TOKEN, {
    prompt: buildDirectivePrompt(ctx),
    actor: "deputy",
    meta: { chamber: "deputy", directiveId: ctx.directive.id },
  });
  if (!result.refused) await reportRun(ctx.trigger, result, ctx.directive);
  return result;
}

// Congress's shared pause switch, checked before Deputy drains its event
// buffer or stamps a directive as run - a paused AI shouldn't silently eat
// the events a directive was meant to see. An unreachable Congress counts as
// paused for the same reason: the run couldn't happen anyway.
export async function isAiPaused(): Promise<boolean> {
  try {
    return (await fetchCongressAiSettings(env.CAPITOL_URL, env.CONGRESS_INTERNAL_TOKEN)).paused;
  } catch (err) {
    console.warn(`Deputy could not read Congress's AI settings: ${(err as Error).message}`);
    return true;
  }
}
