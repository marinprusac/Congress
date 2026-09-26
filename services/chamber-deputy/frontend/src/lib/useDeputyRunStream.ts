import { useAiRunStream, type AiToolCall } from "@congress/congress-ui";

export type DeputyToolCall = AiToolCall;

export interface DeputyRunStreamState {
  // True only while one of *Deputy's* directive runs is in flight - Congress's
  // stream carries every AI run (the owner's chat too), and those aren't ours.
  active: boolean;
  directiveId: number | null;
  toolCalls: DeputyToolCall[];
  text: string | null;
}

// Deputy's view of Congress's shared AI run stream (useAiRunStream): the
// directive runs Deputy tagged with meta { chamber: "deputy", directiveId }
// when it handed them to POST /congress/ai/run (see src/engine.ts).
export function useDeputyRunStream(): DeputyRunStreamState {
  const stream = useAiRunStream();
  const ours = stream.meta.chamber === "deputy" && typeof stream.meta.directiveId === "number";
  if (!ours) return { active: false, directiveId: null, toolCalls: [], text: null };
  return { active: stream.active, directiveId: stream.meta.directiveId as number, toolCalls: stream.toolCalls, text: stream.text };
}
