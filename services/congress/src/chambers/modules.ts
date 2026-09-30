import type { ChamberModule } from "@congress/chamber-kit";
import whatsapp from "chamber-whatsapp/module";

// Every Chamber Congress runs. Adding one is an import and an entry here.
// Notes, Tasks, Documents, Calendar, Mail, Fitness and Map are now premade types (typeEngine), not Chambers.
export const CHAMBER_MODULES: ChamberModule[] = [whatsapp];
