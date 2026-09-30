import type { ChamberModule } from "@congress/chamber-kit";
import calendar from "chamber-calendar/module";
import map from "chamber-map/module";
import fitness from "chamber-fitness/module";
import mail from "chamber-mail/module";
import whatsapp from "chamber-whatsapp/module";

// Every Chamber Congress runs. Adding one is an import and an entry here.
// Notes, Tasks and Documents are now premade types (typeEngine), not Chambers.
export const CHAMBER_MODULES: ChamberModule[] = [calendar, map, fitness, mail, whatsapp];
