import { exhibitsDb } from "../db/client.js";
import { imports } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { getTypeBySlug } from "../store.js";
import { getRecord, retypeRecord } from "../records.js";
import { normalizeKey } from "../keyValues.js";

// One-time: the owner's notes about people become Person records under the
// same ids (owner's pick, 2026-09-30). Delete once it has run in production.

const KEY = "person-notes-v1";

export const PERSON_NOTE_IDS = [
  "01m25qvd1ard22gxdtcekzdcj6", // Borna Futivič
  "01m25qfqjaezbf2v73zt0hhafv", // Bruna Prusac
  "01m1s6z2cnkvyv79efb1qsda30", // Cecilia Katharina Siemens
  "01m25qewgmwq9chvgfr8wds8wz", // Damir Prusac
  "01m25t52g1ymekjppqbrmpbnth", // David Svensson
  "01m25qmwkvnm8pynrkz6fsmpq2", // Dora Prusac
  "01m25qtb9rg7s2hzn85zdd48b6", // Elvis Dubrović
  "01m3hwx2yr4wgtrpdt8c91rxpj", // Hana Fot
  "01m1p8sd99vrtg4pek8tgd4y8v", // Ivana Goa Majandžić
  "01m1m3z3f3p8yxbh5z4ej9apt2", // Ivana Pende
  "01m25sdj6j4p5n6sx6ns34q7bx", // Julius Herrmann
  "01m25qs76c27canacsjzyp3yc8", // Juraj Velimirović
  "01m249yz39qpw9g5hqzw4288vv", // Lorena Lukačič
  "01m1m3yzm26e6xv1qhpgfd45j8", // Marco Comotti
  "01m25qnkdtztr2kjdgaw1sf13d", // Marin Prusac
  "01m25qpheenz8e03331g395srn", // Michelle Špoljar
  "01m25qqxmj6r9h6kcy675t80fz", // Nika Vukojević
  "01m25scy41w34vfxcfjnse8xpg", // Nikos Kontos
  "01m2qvmfqzwsdxwxey63bv9xxc", // Nino ESN Rijeka
  "01m0td2mzsxg4hy7hnc5v02m6a", // Patrik Baršun
  "01m1m3z94rw0ht7vexngd1rprd", // Tea Zlojić
  "01m25qj05dvfr6f4hme2mq1701", // Viktor Prusac
  "01m25qm5t5r1bvrac3wtsq6rs2", // Zrinka Prusac
];

export interface ParsedPerson {
  name: string;
  emails: string[];
  phones: string[];
  birthday: string | null;
  notes: string;
}

const LINE = /^\s*(?:[-*]\s*)?(birthday|born|e-?mail|mail|phone|tel|mobile|number)\s*:\s*(.+?)\s*$/i;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// "1999-07-06", "2 May 2003", "May 2, 2003" -> YYYY-MM-DD; null otherwise.
export function parseBirthday(text: string): string | null {
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return text;
  const words = text.toLowerCase().replace(/,/g, " ").replace(/\./g, " ").split(/\s+/).filter(Boolean);
  const month = words.findIndex((w) => MONTHS.some((m) => m.startsWith(w) && w.length >= 3));
  const nums = words.filter((w) => /^\d+$/.test(w)).map(Number);
  const year = nums.find((n) => n > 1900);
  const day = nums.find((n) => n >= 1 && n <= 31);
  if (month < 0 || !year || !day) return null;
  const m = MONTHS.findIndex((x) => x.startsWith(words[month]!)) + 1;
  return `${year}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parsePersonNote(title: string, body: string): ParsedPerson {
  const out: ParsedPerson = { name: title.trim(), emails: [], phones: [], birthday: null, notes: "" };
  const kept: string[] = [];
  for (const line of body.split("\n")) {
    const m = line.match(LINE);
    const label = m?.[1]!.toLowerCase();
    const value = m?.[2] ?? "";
    if (m && /mail/.test(label!) && normalizeKey("email", value)) out.emails.push(value);
    else if (m && /phone|tel|mobile|number/.test(label!) && normalizeKey("phone", value)) out.phones.push(value);
    else if (m && /birthday|born/.test(label!) && !out.birthday && parseBirthday(value)) out.birthday = parseBirthday(value);
    else kept.push(line);
  }
  out.notes = kept.join("\n").trim();
  return out;
}

export function importPersonNotes(ids = PERSON_NOTE_IDS): { moved: string[]; skipped: string[]; failed: string[] } {
  const stats = { moved: [] as string[], skipped: [] as string[], failed: [] as string[] };
  if (exhibitsDb.select().from(imports).where(eq(imports.key, KEY)).get()) return stats;
  if (!getTypeBySlug("person")) return stats;
  for (const id of ids) {
    const record = getRecord(id);
    if (!record || record.type !== "note") {
      stats.skipped.push(id);
      continue;
    }
    const p = parsePersonNote(String(record.values.title ?? ""), String(record.values.body ?? ""));
    try {
      retypeRecord(id, "person", {
        name: p.name,
        emails: p.emails.join("\n"),
        phones: p.phones.join("\n"),
        birthday: p.birthday,
        notes: p.notes,
      });
      stats.moved.push(`${p.name} (birthday ${p.birthday ? "yes" : "no"}, ${p.emails.length} email, ${p.phones.length} phone)`);
    } catch (err) {
      stats.failed.push(`${id}: ${(err as Error).message}`);
    }
  }
  // A failure leaves it unmarked, so the next boot retries what's left.
  if (stats.failed.length === 0) exhibitsDb.insert(imports).values({ key: KEY, ranAt: new Date(), statsJson: JSON.stringify(stats) }).run();
  console.log(`Person notes import: ${stats.moved.length} moved, ${stats.skipped.length} skipped, ${stats.failed.length} failed`);
  for (const line of [...stats.moved, ...stats.failed]) console.log(`  ${line}`);
  return stats;
}
