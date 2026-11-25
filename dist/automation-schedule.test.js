import { describe, expect, it } from "vitest";
import { scheduledWorkflowSlot } from "./automation-schedule.js";
describe("scheduledWorkflowSlot", () => {
    const now = new Date("2026-11-04T10:15:30.000Z"); // Wednesday
    it("returns today's due daily slot", () => {
        expect(scheduledWorkflowSlot({ type: "schedule", projectId: "p1", cadence: "DAILY", hourUtc: 9, minuteUtc: 30 }, now)?.toISOString()).toBe("2026-11-04T09:30:00.000Z");
    });
    it("does not run a future daily slot early", () => {
        expect(scheduledWorkflowSlot({ type: "schedule", projectId: "p1", cadence: "DAILY", hourUtc: 11, minuteUtc: 0 }, now)).toBeNull();
    });
    it("uses the latest selected weekly UTC weekday", () => {
        expect(scheduledWorkflowSlot({ type: "schedule", projectId: "p1", cadence: "WEEKLY", weekdayUtc: 1, hourUtc: 9, minuteUtc: 0 }, now)?.toISOString()).toBe("2026-11-02T09:00:00.000Z");
    });
    it("rejects incomplete or invalid schedule configuration", () => {
        expect(scheduledWorkflowSlot({ type: "schedule", projectId: "p1", cadence: "WEEKLY", hourUtc: 9, minuteUtc: 0 }, now)).toBeNull();
        expect(scheduledWorkflowSlot({ type: "schedule", projectId: "p1", cadence: "DAILY", hourUtc: 24, minuteUtc: 0 }, now)).toBeNull();
        expect(scheduledWorkflowSlot({ type: "manual", projectId: "p1", cadence: "DAILY", hourUtc: 9, minuteUtc: 0 }, now)).toBeNull();
    });
});
