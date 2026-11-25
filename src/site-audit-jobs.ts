import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { runSiteAudit, type AuditResult } from "./crawler.js";

type CrawlConfiguration = Record<string, unknown> & { maxPages?: unknown; source?: unknown; requestedByUserId?: unknown; lastError?: unknown };
export type SiteAuditProgress = { pagesConsidered: number; pagesCrawled: number; issueCount: number };

function configurationOf(value: unknown): CrawlConfiguration {
  return value && typeof value === "object" && !Array.isArray(value) ? value as CrawlConfiguration : {};
}

export async function executeSiteAuditCrawl(crawlId: string): Promise<{ crawlId: string; pagesCrawled: number; pagesConsidered: number; issueCount: number; healthScore: number }> {
  const crawl = await prisma.crawl.findUnique({
    where: { id: crawlId },
    include: { domain: { select: { id: true, host: true, organizationId: true } } },
  });
  if (!crawl) throw new Error("Site Audit was deleted before the queued crawl started.");
  if (crawl.status === "completed") {
    const config = configurationOf(crawl.configuration);
    const progress = config.progress && typeof config.progress === "object" ? config.progress as SiteAuditProgress : null;
    return {
      crawlId,
      pagesCrawled: crawl.pagesCrawled,
      pagesConsidered: progress?.pagesConsidered ?? crawl.pagesCrawled,
      issueCount: await prisma.auditIssue.count({ where: { crawlId } }),
      healthScore: crawl.healthScore ?? 0,
    };
  }
  if (crawl.status !== "queued" && crawl.status !== "running") throw new Error(`Site Audit cannot run from status "${crawl.status}".`);
  const config = configurationOf(crawl.configuration);
  const maxPages = config.maxPages;
  if (typeof maxPages !== "number" || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 250) {
    throw new Error("Queued Site Audit has an invalid page limit.");
  }
  const executionConfiguration = { ...config };
  delete executionConfiguration.lastError;
  const runningConfiguration = { ...executionConfiguration, progress: { pagesConsidered: 0, pagesCrawled: 0, issueCount: 0 } };
  await prisma.crawl.updateMany({
    where: { id: crawlId, status: { in: ["queued", "running"] } },
    data: { status: "running", startedAt: new Date(), finishedAt: null, pagesCrawled: 0, configuration: runningConfiguration as Prisma.InputJsonObject },
  });
  const result = await runSiteAudit(crawl.domain.host, maxPages, async (progress) => {
    await prisma.crawl.update({
      where: { id: crawlId },
      data: { pagesCrawled: progress.pagesCrawled, configuration: { ...executionConfiguration, progress } as Prisma.InputJsonObject },
    });
  });
  await persistResult(crawl.id, crawl.domain.organizationId, executionConfiguration, result);
  return {
    crawlId,
    pagesCrawled: result.pages.length,
    pagesConsidered: result.pagesConsidered,
    issueCount: result.issues.length,
    healthScore: result.healthScore,
  };
}

async function persistResult(crawlId: string, organizationId: string, config: CrawlConfiguration, result: AuditResult): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.crawlPage.createMany({ data: result.pages.map((page) => ({
      crawlId,
      url: page.url,
      statusCode: page.statusCode,
      title: page.title,
      titleLength: page.titleLength,
      description: page.description,
      h1: page.h1,
      canonical: page.canonical,
      robots: page.robots,
      indexable: page.indexable,
      wordCount: page.wordCount,
      loadMs: page.loadMs,
      h1Count: page.h1Count,
      contentDigest: page.contentDigest,
    })) });
    const savedPages = await tx.crawlPage.findMany({ where: { crawlId }, select: { id: true, url: true } });
    const pageIds = new Map(savedPages.map((page) => [page.url, page.id]));
    const links = result.pages.flatMap((page) => page.links.map((link) => ({
      sourceId: pageIds.get(page.url)!,
      targetId: pageIds.get(link.targetUrl) ?? null,
      targetUrl: link.targetUrl,
      internal: link.internal,
      anchorText: link.anchorText,
    })));
    if (links.length) await tx.crawlLink.createMany({ data: links });
    if (result.issues.length) await tx.auditIssue.createMany({ data: result.issues.map((row) => ({
      crawlId,
      pageUrl: row.pageUrl,
      code: row.code,
      severity: row.severity,
      message: row.message,
      details: row.details as Prisma.InputJsonValue | undefined,
    })) });
    await tx.crawl.update({
      where: { id: crawlId },
      data: {
        status: "completed",
        finishedAt: new Date(),
        pagesCrawled: result.pages.length,
        issueCounts: result.issueCounts as Prisma.InputJsonValue,
        healthScore: result.healthScore,
        configuration: {
          ...config,
          javascriptRendered: true,
          browserRequestsPerPage: 30,
          pagesConsidered: result.pagesConsidered,
          robotsFetched: result.robotsFetched,
          progress: { pagesConsidered: result.pagesConsidered, pagesCrawled: result.pages.length, issueCount: result.issues.length },
        } as Prisma.InputJsonObject,
      },
    });
    await tx.activityLog.create({
      data: {
        organizationId,
        userId: typeof config.requestedByUserId === "string" ? config.requestedByUserId : undefined,
        action: config.source === "seo_schedule" ? "site_audit.scheduled_completed" : "site_audit.completed",
        entityType: "Crawl",
        entityId: crawlId,
        metadata: { pagesCrawled: result.pages.length, pagesConsidered: result.pagesConsidered, issueCount: result.issues.length, healthScore: result.healthScore },
      },
    });
  });
}
