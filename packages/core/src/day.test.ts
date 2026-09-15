import { describe, expect, it } from "vitest";
import { startOfLocalDay } from "./day.js";

describe("startOfLocalDay", () => {
  it("returns local midnight for Asia/Singapore (UTC+8, no DST)", () => {
    // 2024-06-15T10:00:00+08:00
    const now = new Date(Date.UTC(2024, 5, 15, 2, 0, 0));
    const midnight = startOfLocalDay(now, "Asia/Singapore");
    expect(new Date(midnight).toISOString()).toBe("2024-06-14T16:00:00.000Z");
  });

  it("stays on the same day just before SGT midnight", () => {
    // 2024-06-14T23:59:59+08:00
    const now = new Date(Date.UTC(2024, 5, 14, 15, 59, 59));
    const midnight = startOfLocalDay(now, "Asia/Singapore");
    expect(new Date(midnight).toISOString()).toBe("2024-06-13T16:00:00.000Z");
  });

  it("rolls over to the next day right at SGT midnight", () => {
    // 2024-06-15T00:00:00+08:00
    const now = new Date(Date.UTC(2024, 5, 14, 16, 0, 0));
    const midnight = startOfLocalDay(now, "Asia/Singapore");
    expect(new Date(midnight).toISOString()).toBe("2024-06-14T16:00:00.000Z");
  });

  it("is idempotent when fed its own output", () => {
    const now = new Date(Date.UTC(2024, 5, 15, 2, 0, 0));
    const midnight = startOfLocalDay(now, "Asia/Singapore");
    expect(startOfLocalDay(new Date(midnight), "Asia/Singapore")).toBe(midnight);
  });

  it("uses EST (not the post-transition EDT) for midnight on NY spring-forward day", () => {
    // 2024-03-10: US spring-forward, clocks jump 02:00 EST -> 03:00 EDT. `now` given here is
    // 10:00 EDT (after the jump), but midnight that day was still EST (UTC-5).
    const now = new Date(Date.UTC(2024, 2, 10, 14, 0, 0)); // 2024-03-10T10:00:00-04:00
    const midnight = startOfLocalDay(now, "America/New_York");
    expect(new Date(midnight).toISOString()).toBe("2024-03-10T05:00:00.000Z");
  });

  it("stays correct just before NY spring-forward, while still EST", () => {
    const now = new Date(Date.UTC(2024, 2, 10, 6, 0, 0)); // 2024-03-10T01:00:00-05:00
    const midnight = startOfLocalDay(now, "America/New_York");
    expect(new Date(midnight).toISOString()).toBe("2024-03-10T05:00:00.000Z");
  });

  it("uses EDT (not the post-transition EST) for midnight on NY fall-back day", () => {
    // 2024-11-03: US fall-back, clocks fall 02:00 EDT -> 01:00 EST. Midnight that day was still
    // EDT (UTC-4); `now` given here is 10:00 EST (after the fall-back).
    const now = new Date(Date.UTC(2024, 10, 3, 15, 0, 0)); // 2024-11-03T10:00:00-05:00
    const midnight = startOfLocalDay(now, "America/New_York");
    expect(new Date(midnight).toISOString()).toBe("2024-11-03T04:00:00.000Z");
  });

  it("uses CET (not the post-transition CEST) for midnight on Paris spring-forward day", () => {
    // 2024-03-31: EU spring-forward, clocks jump 02:00 CET -> 03:00 CEST. Midnight that day was
    // still CET (UTC+1); `now` given here is 10:00 CEST (after the jump).
    const now = new Date(Date.UTC(2024, 2, 31, 8, 0, 0)); // 2024-03-31T10:00:00+02:00
    const midnight = startOfLocalDay(now, "Europe/Paris");
    expect(new Date(midnight).toISOString()).toBe("2024-03-30T23:00:00.000Z");
  });

  it("uses CEST (not the post-transition CET) for midnight on Paris fall-back day", () => {
    // 2024-10-27: EU fall-back, clocks fall 03:00 CEST -> 02:00 CET. Midnight that day was still
    // CEST (UTC+2); `now` given here is 10:00 CET (after the fall-back).
    const now = new Date(Date.UTC(2024, 9, 27, 9, 0, 0)); // 2024-10-27T10:00:00+01:00
    const midnight = startOfLocalDay(now, "Europe/Paris");
    expect(new Date(midnight).toISOString()).toBe("2024-10-26T22:00:00.000Z");
  });
});
