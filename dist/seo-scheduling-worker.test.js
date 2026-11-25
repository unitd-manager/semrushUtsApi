import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => {
    const prisma = {
        backgroundJob: { findFirst: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
        seoScheduleExecution: { updateMany: vi.fn() },
        crawl: { findUnique: vi.fn(), updateMany: vi.fn() },
        activityLog: { create: vi.fn() },
        $transaction: vi.fn(),
    };
    const tx = {
        backgroundJob: { updateMany: vi.fn() },
        seoScheduleExecution: { updateMany: vi.fn() },
        crawl: { findUnique: vi.fn(), updateMany: vi.fn() },
        activityLog: { create: vi.fn() },
    };
    return { prisma, tx, executeSiteAuditCrawl: vi.fn() };
});
vi.mock("./db.js", () => ({ prisma: mocks.prisma }));
vi.mock("./site-audit-jobs.js", () => ({ executeSiteAuditCrawl: mocks.executeSiteAuditCrawl }));
vi.mock("./daily-seo-briefings.js", () => ({ generateDailySeoBriefing: vi.fn() }));
import { processSeoBackgroundJobs } from "./seo-scheduling.js";
const queuedJob = {
    id: "job-1",
    organizationId: "org-1",
    type: "SITE_AUDIT_EXECUTION",
    payload: { crawlId: "crawl-1" },
    status: "PENDING",
    attempts: 0,
    maxAttempts: 5,
};
describe("SEO background worker", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.prisma.backgroundJob.findFirst.mockResolvedValueOnce(queuedJob).mockResolvedValue(null);
        mocks.prisma.backgroundJob.updateMany.mockResolvedValue({ count: 1 });
        mocks.prisma.backgroundJob.findUnique.mockResolvedValue({ ...queuedJob, status: "RUNNING", attempts: 1 });
        mocks.prisma.$transaction.mockImplementation(async (callback) => callback(mocks.tx));
        mocks.tx.backgroundJob.updateMany.mockResolvedValue({ count: 1 });
        mocks.tx.seoScheduleExecution.updateMany.mockResolvedValue({ count: 1 });
        mocks.tx.crawl.findUnique.mockResolvedValue({ configuration: { maxPages: 10 } });
        mocks.tx.crawl.updateMany.mockResolvedValue({ count: 1 });
        mocks.tx.activityLog.create.mockResolvedValue({});
    });
    it("dispatches manual audit jobs and finalizes only under the worker's lease", async () => {
        mocks.executeSiteAuditCrawl.mockResolvedValue({ crawlId: "crawl-1", pagesCrawled: 4, pagesConsidered: 5, issueCount: 2, healthScore: 90 });
        await processSeoBackgroundJobs(new Date("2026-11-05T10:00:00.000Z"), 1);
        expect(mocks.executeSiteAuditCrawl).toHaveBeenCalledWith("crawl-1");
        expect(mocks.tx.backgroundJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "job-1", status: "RUNNING", lockedBy: expect.any(String) },
            data: expect.objectContaining({ status: "COMPLETED" }),
        }));
    });
    it("requeues a crawl and preserves its error when an attempt fails", async () => {
        mocks.executeSiteAuditCrawl.mockRejectedValue(new Error("Chromium is unavailable."));
        await processSeoBackgroundJobs(new Date("2026-11-05T10:00:00.000Z"), 1);
        expect(mocks.tx.backgroundJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "job-1", status: "RUNNING", lockedBy: expect.any(String) },
            data: expect.objectContaining({ status: "PENDING", error: "Chromium is unavailable.", runAt: new Date("2026-11-05T10:01:00.000Z") }),
        }));
        expect(mocks.tx.crawl.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "crawl-1", status: { in: ["queued", "running"] } },
            data: expect.objectContaining({ status: "queued", configuration: expect.objectContaining({ lastError: "Chromium is unavailable." }) }),
        }));
    });
});
