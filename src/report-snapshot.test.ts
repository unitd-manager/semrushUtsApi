import { describe, expect, it, vi } from "vitest";
import { buildReportSnapshot } from "./report-snapshot.js";

describe("saved report snapshots", () => {
  it("adds crawl coverage and orders audit findings by action priority", async () => {
    const finishedAt = new Date("2026-10-12T10:00:00.000Z");
    const db = {
      domain: { findFirst: vi.fn().mockResolvedValue({ id: "domain-1", host: "example.com" }) },
      crawl: { findMany: vi.fn().mockResolvedValue([{
        id: "crawl-1",
        status: "completed",
        startedAt: new Date("2026-10-12T09:00:00.000Z"),
        finishedAt,
        pagesCrawled: 12,
        healthScore: 82,
        issueCounts: { CRITICAL: 1, ERROR: 2, WARNING: 3, NOTICE: 0 },
        configuration: { maxPages: 50, pagesConsidered: 15, robotsFetched: true },
        _count: { pages: 12, issues: 6 },
      }]) },
      auditIssue: {
        findMany: vi.fn().mockResolvedValue([
          { severity: "WARNING", code: "MISSING_H1", pageUrl: "https://example.com/a", message: "Missing H1", details: null },
          { severity: "CRITICAL", code: "HTTP_5XX", pageUrl: "https://example.com/b", message: "Server error", details: null },
        ]),
        groupBy: vi.fn().mockResolvedValue([
          { severity: "CRITICAL", _count: { _all: 1 } },
          { severity: "ERROR", _count: { _all: 2 } },
          { severity: "WARNING", _count: { _all: 3 } },
        ]),
      },
      crawlPage: { findMany: vi.fn().mockResolvedValue([{ url: "https://example.com/", statusCode: 200 }]) },
    };

    const result = await buildReportSnapshot(db as never, "org-1", { projectId: "project-1", sections: ["site_audit"], country: "US", device: "desktop" });
    const section = result?.sections.site_audit;

    expect(section?.rows.map((row) => (row as { priority: string }).priority)).toEqual(["Immediate", "Medium"]);
    expect(section?.summary).toMatchObject({
      pagesCrawled: 12,
      pagesConsidered: 15,
      maxPages: 50,
      priorityCounts: { Immediate: 1, High: 2, Medium: 3 },
    });
    expect(section?.note).toContain("bounded sample");
    expect(section?.pages).toHaveLength(1);
    expect(section?.history).toHaveLength(1);
  });

  it("includes only saved, tenant-scoped DataForSEO traffic estimates without making provider calls", async () => {
    const observedAt = new Date("2026-10-12T10:00:00.000Z");
    const db = {
      domain: { findFirst: vi.fn().mockResolvedValue({ id: "domain-1", host: "example.com" }) },
      campaign: { findMany: vi.fn().mockResolvedValue([
        { id: "estimate-us", createdAt: observedAt, settings: { country: "US", provider: "dataforseo_labs_domain_rank_overview", organic: { etv: 1200, count: 300 } } },
        { id: "estimate-gb", createdAt: observedAt, settings: { country: "GB", organic: { etv: 50, count: 20 } } },
      ]) },
    };

    const result = await buildReportSnapshot(db as never, "org-1", { projectId: "project-1", sections: ["traffic_estimates"], country: "US", device: "desktop" });
    const section = result?.sections.traffic_estimates;

    expect(db.campaign.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        channel: "market_traffic_estimate",
        settings: { path: "projectId", equals: "project-1" },
      }),
    }));
    expect(section).toMatchObject({
      status: "available",
      source: "saved DataForSEO Labs domain estimates",
      confidence: "PROVIDER_ESTIMATE",
      observedAt: observedAt.toISOString(),
      rows: [{ country: "US", organic: { etv: 1200, count: 300 }, confidence: "PROVIDER_ESTIMATE" }],
    });
    expect(section?.note).toContain("does not make a paid provider request");
  });
});
