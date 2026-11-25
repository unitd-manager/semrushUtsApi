import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => {
    const crawl = {
        findUnique: vi.fn(),
        updateMany: vi.fn(),
        update: vi.fn(),
    };
    const tx = {
        crawlPage: { createMany: vi.fn(), findMany: vi.fn() },
        crawlLink: { createMany: vi.fn() },
        auditIssue: { createMany: vi.fn() },
        crawl: { update: vi.fn() },
        activityLog: { create: vi.fn() },
    };
    return {
        prisma: { crawl, $transaction: vi.fn(async (callback) => callback(tx)) },
        tx,
        runSiteAudit: vi.fn(),
    };
});
vi.mock("./db.js", () => ({ prisma: mocks.prisma }));
vi.mock("./crawler.js", () => ({ runSiteAudit: mocks.runSiteAudit }));
import { executeSiteAuditCrawl } from "./site-audit-jobs.js";
describe("queued Site Audit execution", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.prisma.crawl.findUnique.mockResolvedValue({
            id: "crawl-1",
            status: "queued",
            configuration: { maxPages: 10, source: "manual", lastError: "A previous run failed." },
            domain: { id: "domain-1", host: "example.com", organizationId: "org-1" },
        });
        mocks.prisma.crawl.updateMany.mockResolvedValue({ count: 1 });
        mocks.tx.crawlPage.createMany.mockResolvedValue({ count: 0 });
        mocks.tx.crawlPage.findMany.mockResolvedValue([]);
        mocks.tx.crawlLink.createMany.mockResolvedValue({ count: 0 });
        mocks.tx.auditIssue.createMany.mockResolvedValue({ count: 0 });
        mocks.tx.crawl.update.mockResolvedValue({});
        mocks.tx.activityLog.create.mockResolvedValue({});
    });
    it("persists crawl progress and final results", async () => {
        mocks.runSiteAudit.mockImplementation(async (_host, _maxPages, onProgress) => {
            await onProgress({ pagesConsidered: 5, pagesCrawled: 4, issueCount: 2 });
            return {
                pages: [],
                issues: [],
                robotsFetched: true,
                pagesConsidered: 5,
                healthScore: 100,
                issueCounts: { CRITICAL: 0, ERROR: 0, WARNING: 0, NOTICE: 0 },
            };
        });
        await expect(executeSiteAuditCrawl("crawl-1")).resolves.toMatchObject({
            crawlId: "crawl-1",
            pagesCrawled: 0,
            pagesConsidered: 5,
            issueCount: 0,
            healthScore: 100,
        });
        expect(mocks.prisma.crawl.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "crawl-1" },
            data: expect.objectContaining({ pagesCrawled: 4, configuration: expect.objectContaining({ progress: { pagesConsidered: 5, pagesCrawled: 4, issueCount: 2 } }) }),
        }));
        expect(mocks.tx.crawl.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "crawl-1" },
            data: expect.objectContaining({ status: "completed", healthScore: 100 }),
        }));
        expect(mocks.tx.crawl.update.mock.calls[0][0].data.configuration).not.toHaveProperty("lastError");
    });
    it("rejects invalid page limits before invoking the crawler", async () => {
        mocks.prisma.crawl.findUnique.mockResolvedValue({
            id: "crawl-1",
            status: "queued",
            configuration: { maxPages: 251 },
            domain: { id: "domain-1", host: "example.com", organizationId: "org-1" },
        });
        await expect(executeSiteAuditCrawl("crawl-1")).rejects.toThrow("invalid page limit");
        expect(mocks.runSiteAudit).not.toHaveBeenCalled();
    });
});
