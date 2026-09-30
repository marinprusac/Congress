import type { ComponentType } from "react";
import type { ConnectorStatus } from "@/lib/connectorsListApi";
import { GoogleCalendarPanel } from "./GoogleCalendarPanel";
import { GmailPanel } from "./GmailPanel";
import { HealthPanel, HevyPanel } from "./FitnessPanels";
import { LocationPanel } from "./LocationPanel";
import { WhatsappPanel } from "./WhatsappPanel";

// Connectors are hand-written, so their setup panels are too.
export const CONNECTOR_PANELS: Record<string, ComponentType<{ status: ConnectorStatus }>> = {
  "google-calendar": GoogleCalendarPanel,
  gmail: GmailPanel,
  hevy: HevyPanel,
  health: HealthPanel,
  location: LocationPanel,
  whatsapp: WhatsappPanel,
};
