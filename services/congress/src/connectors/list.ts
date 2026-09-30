import type { Connector } from "./contract.js";
import { googleCalendar } from "./googleCalendar/index.js";

// Every connector Congress starts at boot.
export const CONNECTORS: Connector[] = [googleCalendar];
