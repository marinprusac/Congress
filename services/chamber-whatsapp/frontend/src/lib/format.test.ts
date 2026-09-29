import { describe, expect, it } from "vitest";
import type { Message, ReaderStatus } from "./api";
import { chatTitle, jidLabel, previewText, statusNotice, withDayBreaks } from "./format";

const status = (over: Partial<ReaderStatus>): ReaderStatus => ({
  state: "connected",
  since: 0,
  lastEventAt: 0,
  lastPhoneAt: 0,
  mediaMaxBytes: 1,
  ...over,
});

const msg = (id: string, ts: number): Message => ({
  chatJid: "a@s.whatsapp.net", id, senderJid: "", senderName: "", fromMe: false, ts, type: "text", text: id,
  quoted: null, editedAt: null, revokedAt: null, media: null, reactions: [],
});

describe("WhatsApp formatting", () => {
  it("labels JIDs without leaking internal ids", () => {
    expect(jidLabel("385911111111@s.whatsapp.net")).toBe("+385911111111");
    expect(jidLabel("385911111111:12@s.whatsapp.net")).toBe("+385911111111");
    expect(jidLabel("99887766@lid")).toBe("Unknown contact");
    expect(chatTitle({ jid: "1-2@g.us", name: "" })).toBe("Group");
    expect(chatTitle({ jid: "1@s.whatsapp.net", name: "Ana" })).toBe("Ana");
  });

  it("previews by type", () => {
    expect(previewText("hi\nthere", "text", false)).toBe("hi");
    expect(previewText("look", "image", false)).toBe("📷 Photo: look");
    expect(previewText("", "voice", false)).toBe("🎤 Voice message");
    expect(previewText("Lunch?\n• Yes", "poll", false)).toBe("📊 Lunch?");
    expect(previewText("secret", "text", true)).toBe("🚫 This message was deleted");
  });

  it("orders oldest-first with one header per day", () => {
    const day1 = new Date(2026, 0, 1, 10).getTime();
    const day2 = new Date(2026, 0, 2, 9).getTime();
    const rows = withDayBreaks([msg("c", day2), msg("b", day1 + 60_000), msg("a", day1)]);
    expect(rows.map((r) => r.message.id)).toEqual(["a", "b", "c"]);
    expect(rows.map((r) => r.day !== null)).toEqual([true, false, true]);
  });

  it("warns about reader states and a silent phone", () => {
    const now = Date.UTC(2026, 8, 29);
    expect(statusNotice(null, true)?.tone).toBe("alert");
    expect(statusNotice(status({ state: "logged_out" }), false)?.text).toContain("Re-pair");
    expect(statusNotice(status({ lastPhoneAt: now - 2 * 86_400_000 }), false, now)).toBeNull();
    expect(statusNotice(status({ lastPhoneAt: now - 11 * 86_400_000 }), false, now)?.text).toContain("11 days");
    // Never seen (e.g. just paired, nothing yet) is not an alarm.
    expect(statusNotice(status({}), false, now)).toBeNull();
  });
});
