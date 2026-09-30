import type { ChamberModule } from "@congress/chamber-kit";
import calendar from "chamber-calendar/module";
import documents from "chamber-documents/module";
import tasks from "chamber-tasks/module";
import map from "chamber-map/module";
import fitness from "chamber-fitness/module";
import mail from "chamber-mail/module";
import whatsapp from "chamber-whatsapp/module";

// Every Chamber Congress runs. Adding one is an import and an entry here.
// Notes is now the premade Note type (typeEngine), not a Chamber.
export const CHAMBER_MODULES: ChamberModule[] = [calendar, documents, tasks, map, fitness, mail, whatsapp];
