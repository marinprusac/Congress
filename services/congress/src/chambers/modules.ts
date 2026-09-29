import type { ChamberModule } from "@congress/chamber-kit";
import notes from "chamber-notes/module";
import calendar from "chamber-calendar/module";
import documents from "chamber-documents/module";
import tasks from "chamber-tasks/module";
import map from "chamber-map/module";
import fitness from "chamber-fitness/module";
import mail from "chamber-mail/module";
import whatsapp from "chamber-whatsapp/module";

// Every Chamber Congress runs. Adding one is an import and an entry here.
export const CHAMBER_MODULES: ChamberModule[] = [notes, calendar, documents, tasks, map, fitness, mail, whatsapp];
