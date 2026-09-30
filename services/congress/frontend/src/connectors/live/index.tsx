import type { ComponentType } from "react";
import type { RecordDto } from "@congress/shared-types";
import { GmailThread } from "./GmailThread";

// Hand-written renderers for a connector's live content (read.detail), keyed
// by "<connector>:<kind>". A record page shows one where its body would go.

export interface LiveProps {
  recordId: string;
  binding: NonNullable<RecordDto["binding"]>;
  runAction: (action: string) => void;
}

export const LIVE_RENDERERS: Record<string, ComponentType<LiveProps>> = {
  "gmail:thread": GmailThread,
};
