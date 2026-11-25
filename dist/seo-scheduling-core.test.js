import { describe, expect, it } from "vitest";
import { nextSeoOccurrence, scheduleOccurrenceKey, seoOccurrencesBetween } from "./seo-scheduling-core.js";
describe("SEO schedule recurrence", () => {
    it("schedules a weekly occurrence in its configured timezone", () => {
        const after = new Date("2026-11-05T00:00:00.000Z"); // Thursday in UTC
        const next = nextSeoOccurrence(after, "America/New_York", { frequency: "WEEKLY", weekdays: [1], hour: 9, minute: 30 });
        expect(next?.toISOString()).toBe("2026-11-09T14:30:00.000Z");
    });
    it("returns null when a one-time schedule is no longer in the future", () => {
        expect(nextSeoOccurrence(new Date("2026-11-05T10:00:00Z"), "UTC", { frequency: "ONCE", at: "2026-11-05T09:00:00Z" })).toBeNull();
    });
    it("honors a future recurring start date while preserving local wall-clock time", () => {
        const after = new Date("2026-11-05T00:00:00Z");
        const next = nextSeoOccurrence(after, "America/New_York", { frequency: "DAILY", startAt: "2026-11-08T14:30:00.000Z", hour: 9, minute: 30 });
        expect(next?.toISOString()).toBe("2026-11-08T14:30:00.000Z");
    });
    it("uses a stable occurrence key for duplicate prevention", () => {
        expect(scheduleOccurrenceKey("s1", new Date("2026-11-05T10:00:00Z"))).toBe("s1:2026-11-05T10:00:00.000Z");
    });
    it("expands timezone-aware calendar occurrences within an inclusive range", () => {
        expect(seoOccurrencesBetween(new Date("2026-11-08T00:00:00Z"), new Date("2026-11-10T23:59:59Z"), "America/New_York", { frequency: "DAILY", hour: 9, minute: 30 }).map((date) => date.toISOString())).toEqual(["2026-11-08T14:30:00.000Z", "2026-11-09T14:30:00.000Z", "2026-11-10T14:30:00.000Z"]);
        expect(seoOccurrencesBetween(new Date("2026-11-05T10:00:00Z"), new Date("2026-11-05T11:00:00Z"), "UTC", { frequency: "ONCE", at: "2026-11-05T10:00:00Z" })).toHaveLength(1);
        expect(() => seoOccurrencesBetween(new Date("invalid"), new Date(), "UTC", { frequency: "ONCE", at: "2026-11-05T10:00:00Z" })).toThrow(/valid calendar/u);
    });
});
