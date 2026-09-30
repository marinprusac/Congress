import type { ComponentType } from "react";
import type { ConnectorStatus } from "@/lib/connectorsListApi";
import { GoogleCalendarPanel } from "./GoogleCalendarPanel";

// Connectors are hand-written, so their setup panels are too.
export const CONNECTOR_PANELS: Record<string, ComponentType<{ status: ConnectorStatus }>> = {
  "google-calendar": GoogleCalendarPanel,
};
