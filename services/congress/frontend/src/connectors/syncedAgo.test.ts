import { describe, expect, it } from "vitest";
import { syncedAgo } from "./syncedAgo";

describe("syncedAgo", () => {
  it("reads naturally at each scale", () => {
    const now = Date.parse("2026-09-30T12:00:00Z");
    const at = (ms: number) => new Date(now - ms).toISOString();
    expect(syncedAgo(null, now)).toBe("Not synced yet");
    expect(syncedAgo(at(20_000), now)).toBe("Synced just now");
    expect(syncedAgo(at(5 * 60_000), now)).toBe("Synced 5 min ago");
    expect(syncedAgo(at(3 * 3_600_000), now)).toBe("Synced 3 h ago");
    expect(syncedAgo(at(49 * 3_600_000), now)).toBe("Synced 2 d ago");
  });
});
