import type { ChamberModule } from "@congress/chamber-kit";
import map from "chamber-map/module";
import whatsapp from "chamber-whatsapp/module";

// Every Chamber Congress runs. Adding one is an import and an entry here.
// Notes, Tasks, Documents, Calendar, Mail and Fitness are now premade types (typeEngine), not Chambers.
export const CHAMBER_MODULES: ChamberModule[] = [map, whatsapp];
