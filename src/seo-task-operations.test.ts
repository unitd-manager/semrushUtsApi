import { describe, expect, it } from "vitest";
import { canTransitionTask, dependencyWouldCycle, isTaskOverdue, recommendSeoTaskPriority } from "./seo-task-operations.js";

describe("SEO task workflow", () => {
  it("keeps completion, approval, and verification as separate transitions", () => {
    expect(canTransitionTask("IN_PROGRESS", "READY_FOR_REVIEW")).toBe(true);
    expect(canTransitionTask("READY_FOR_REVIEW", "APPROVED")).toBe(true);
    expect(canTransitionTask("IN_PROGRESS", "VERIFIED")).toBe(false);
    expect(canTransitionTask("VERIFIED", "REOPENED")).toBe(true);
  });

  it("recommends priority using severity and issue reach", () => {
    expect(recommendSeoTaskPriority({ severity: "CRITICAL", affectedUrlCount: 200 })).toBe("P0");
    expect(recommendSeoTaskPriority({ severity: "CRITICAL", affectedUrlCount: 1 })).toBe("P1");
    expect(recommendSeoTaskPriority({ severity: "WARNING", affectedUrlCount: 2 })).toBe("P3");
    expect(recommendSeoTaskPriority({ severity: "ERROR", affectedUrlCount: 1 })).toBe("P2");
  });

  it("prevents direct and indirect dependency cycles", () => {
    const edges = [{ taskId: "a", dependsOnTaskId: "b" }, { taskId: "b", dependsOnTaskId: "c" }];
    expect(dependencyWouldCycle("c", "a", edges)).toBe(true);
    expect(dependencyWouldCycle("a", "a", edges)).toBe(true);
    expect(dependencyWouldCycle("a", "d", edges)).toBe(false);
  });

  it("does not count finished work as overdue", () => {
    const now = new Date("2026-11-05T12:00:00Z");
    expect(isTaskOverdue({ dueDate: new Date("2026-11-04T00:00:00Z"), status: "IN_PROGRESS" }, now)).toBe(true);
    expect(isTaskOverdue({ dueDate: new Date("2026-11-04T00:00:00Z"), status: "VERIFIED" }, now)).toBe(false);
  });
});
