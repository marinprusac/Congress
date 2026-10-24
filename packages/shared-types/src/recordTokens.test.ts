import { describe, expect, it } from "vitest";
import { buildChipToken, buildRecordToken, parseRecordToken } from "./recordTokens.js";

describe("parseRecordToken", () => {
  it("splits on the first colon after the prefix, so ids may contain colons", () => {
    // Calendar's Record ids are composite (account:calendar:event), so a
    // naive split(":") here would truncate every calendar reference in the
    // system to its first segment.
    expect(parseRecordToken("record:calendar:event-3:cal:evt123")).toEqual({
      chamber: "calendar",
      id: "event-3:cal:evt123",
    });
  });

  it("parses an ordinary single-segment id", () => {
    expect(parseRecordToken("record:notes:note-42")).toEqual({ chamber: "notes", id: "note-42" });
  });

  it("returns null for anything without the record: prefix", () => {
    expect(parseRecordToken("notes:note-42")).toBeNull();
    expect(parseRecordToken("Some Note Title")).toBeNull();
    expect(parseRecordToken("")).toBeNull();
    // Prefix has to be at the start, not merely present.
    expect(parseRecordToken("see record:notes:note-42")).toBeNull();
  });

  it("returns null when there is no separator after the chamber", () => {
    expect(parseRecordToken("record:notes")).toBeNull();
  });

  it("returns null for an empty chamber or an empty id", () => {
    expect(parseRecordToken("record::note-42")).toBeNull();
    expect(parseRecordToken("record:notes:")).toBeNull();
  });
});

describe("buildRecordToken", () => {
  it("round-trips through parseRecordToken", () => {
    for (const ref of [
      { chamber: "notes", id: "note-1" },
      { chamber: "calendar", id: "event-3:cal:evt123" },
      { chamber: "map", id: "place-77" },
    ]) {
      expect(parseRecordToken(buildRecordToken(ref))).toEqual(ref);
    }
  });
});

describe("buildChipToken", () => {
  it("wraps the token in the [[target|alias]] syntax the picker inserts", () => {
    expect(buildChipToken({ chamber: "notes", id: "note-7", name: "Weekly review" })).toBe(
      "[[record:notes:note-7|Weekly review]]"
    );
  });
});

describe("legacy tokens", () => {
  it("reads the old exhibit: prefix and writes record:", () => {
    const parsed = parseRecordToken("exhibit:e:abc");
    expect(parsed).toEqual({ chamber: "e", id: "abc" });
    expect(buildRecordToken(parsed!)).toBe("record:e:abc");
  });
});
