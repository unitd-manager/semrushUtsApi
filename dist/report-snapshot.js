import { Prisma } from "@prisma/client";
export const reportSectionNames = ["site_audit", "rankings", "backlinks", "keyword_metrics", "competitors", "content", "traffic_estimates"];
export async function buildReportSnapshot(db, organizationId, input) {
    const domain = await db.domain.findFirst({ where: { projectId: input.projectId, organizationId, isPrimary: true }, select: { id: true, host: true } });
    if (!domain)
        return null;
    const sections = {};
    const setSection = (name, rows, source, confidence, observedAt, note) => {
        const section = { status: rows.length ? "available" : "no_data", source, confidence, observedAt: observedAt instanceof Date ? observedAt.toISOString() : observedAt, note, rows };
        sections[name] = section;
        return section;
    };
    for (const section of input.sections) {
        if (section === "site_audit") {
            const history = await db.crawl.findMany({ where: { domainId: domain.id, status: "completed" }, orderBy: { finishedAt: "desc" }, take: 10, include: { _count: { select: { pages: true, issues: true } } } });
            const latest = history[0];
            const [issues, pages] = latest ? await Promise.all([
                db.auditIssue.findMany({ where: { crawlId: latest.id }, orderBy: [{ severity: "asc" }, { code: "asc" }, { pageUrl: "asc" }], take: 10000 }),
                db.crawlPage.findMany({ where: { crawlId: latest.id }, orderBy: { url: "asc" }, take: 250, select: { url: true, statusCode: true, title: true, description: true, h1: true, canonical: true, indexable: true, wordCount: true, loadMs: true } }),
            ]) : [[], []];
            const issueTotal = latest?._count.issues ?? 0;
            const latestConfiguration = latest?.configuration && typeof latest.configuration === "object" ? latest.configuration : {};
            const priorityBySeverity = { CRITICAL: "Immediate", ERROR: "High", WARNING: "Medium", NOTICE: "Review" };
            const severityOrder = { CRITICAL: 0, ERROR: 1, WARNING: 2, NOTICE: 3 };
            const prioritizedIssues = [...issues].sort((a, b) => (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4));
            const severityTotals = latest ? await db.auditIssue.groupBy({ by: ["severity"], where: { crawlId: latest.id }, _count: { _all: true } }) : [];
            const priorityCounts = severityTotals.reduce((counts, item) => {
                const priority = priorityBySeverity[item.severity] ?? "Review";
                counts[priority] = (counts[priority] ?? 0) + item._count._all;
                return counts;
            }, {});
            const summaryNote = latest
                ? `Latest crawl: ${latest.pagesCrawled} HTML pages, ${issueTotal} findings, health ${latest.healthScore ?? "unavailable"}/100. Findings are ordered by severity. Crawl coverage is a bounded sample, not a complete website or search-index inventory. Health is a local weighted issue score, not a domain authority metric.`
                : "No completed Site Audit is available for this project.";
            const siteAudit = setSection(section, prioritizedIssues.map((item) => ({
                priority: priorityBySeverity[item.severity] ?? "Review",
                severity: item.severity,
                code: item.code,
                pageUrl: item.pageUrl,
                message: item.message,
                details: item.details,
            })), "first-party crawler records", "FIRST_PARTY", latest?.finishedAt ?? null, summaryNote);
            siteAudit.status = latest ? "available" : "no_data";
            siteAudit.summary = latest ? {
                crawlId: latest.id, status: latest.status, startedAt: latest.startedAt, finishedAt: latest.finishedAt,
                pagesCrawled: latest.pagesCrawled, pagesConsidered: latestConfiguration.pagesConsidered ?? latest.pagesCrawled,
                issueTotal, issueCounts: latest.issueCounts, healthScore: latest.healthScore,
                maxPages: latestConfiguration.maxPages ?? null, robotsFetched: latestConfiguration.robotsFetched ?? null,
                priorityCounts,
                crawlCoverage: "Bounded crawl sample; not a complete website or search-index inventory.",
            } : null;
            siteAudit.history = history.map((crawl) => ({ id: crawl.id, startedAt: crawl.startedAt, finishedAt: crawl.finishedAt, status: crawl.status, pagesCrawled: crawl.pagesCrawled, issueCount: crawl._count.issues, healthScore: crawl.healthScore }));
            siteAudit.pages = pages;
            siteAudit.truncated = issueTotal > issues.length;
            if (siteAudit.truncated)
                siteAudit.note += ` Findings are capped at ${issues.length} of ${issueTotal}.`;
        }
        else if (section === "rankings") {
            const rows = await db.$queryRaw(Prisma.sql `SELECT \`keyword\`, \`position\`, \`url\`, \`observedAt\`, \`provider\`, \`confidence\` FROM (SELECT \`keyword\`, \`position\`, \`url\`, \`observedAt\`, \`provider\`, \`confidence\`, ROW_NUMBER() OVER (PARTITION BY \`keyword\` ORDER BY \`observedAt\` DESC) AS row_num FROM \`Ranking\` WHERE \`domainId\` = ${domain.id} AND \`location\` = ${input.country} AND \`device\` = ${input.device}) latest WHERE row_num = 1 ORDER BY \`observedAt\` DESC LIMIT 100`);
            setSection(section, rows, "saved live SERP snapshots", "PROVIDER_OBSERVED", rows[0]?.observedAt ?? null, `Market ${input.country}; device ${input.device}. Missing target positions remain null.`);
        }
        else if (section === "backlinks") {
            const [snapshots, rows] = await Promise.all([db.backlinkSnapshot.findMany({ where: { domainId: domain.id }, orderBy: { observedAt: "desc" }, take: 5 }), db.backlink.findMany({ where: { domainId: domain.id }, orderBy: { lastSeen: "desc" }, take: 100 })]);
            setSection(section, [...snapshots.map((snapshot) => ({ recordType: "summary_snapshot", ...snapshot })), ...rows.map((row) => ({ recordType: "backlink_record", ...row }))], snapshots[0]?.provider ?? "saved provider backlink records", snapshots[0]?.confidence ?? "PROVIDER_OBSERVED", snapshots[0]?.observedAt ?? null, "Contains up to five summary snapshots and 100 saved referring-page records.");
        }
        else if (section === "keyword_metrics") {
            const terms = await db.keyword.findMany({ where: { organizationId }, orderBy: { phrase: "asc" }, take: 100, include: { metrics: { orderBy: { observedAt: "desc" }, take: 1 } } });
            const rows = terms.flatMap((term) => term.metrics.length ? [{ phrase: term.phrase, locale: term.locale, ...term.metrics[0] }] : []);
            setSection(section, rows, "saved keyword provider metrics", "PROVIDER_ESTIMATE", rows[0]?.observedAt ?? null, "Only terms with a stored metric are included; missing metrics are not synthesized.");
        }
        else if (section === "competitors") {
            const competitors = await db.competitor.findMany({ where: { domainId: domain.id }, orderBy: { host: "asc" }, take: 100, include: { snapshots: { where: { location: input.country, kind: "DISCOVERY" }, orderBy: { observedAt: "desc" }, take: 1 } } });
            const rows = competitors.flatMap((competitor) => competitor.snapshots.map((snapshot) => ({ host: competitor.host, ...snapshot.metrics, observedAt: snapshot.observedAt, provider: snapshot.provider, confidence: snapshot.confidence })));
            setSection(section, rows, "saved DataForSEO Labs competitor snapshots", "PROVIDER_ESTIMATE", rows[0]?.observedAt ?? null, `Market ${input.country}. Competitor traffic and keyword totals are third-party estimates.`);
        }
        else if (section === "content") {
            const rows = await db.contentPiece.findMany({ where: { organizationId }, orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, title: true, url: true, targetKeyword: true, status: true, score: true, updatedAt: true } });
            setSection(section, rows, "workspace content records", "USER_ENTERED", rows[0]?.updatedAt ?? null, "Content readiness scores are local editorial checks, not search performance.");
        }
        else if (section === "traffic_estimates") {
            const snapshots = await db.campaign.findMany({ where: { organizationId, channel: "market_traffic_estimate", settings: { path: "projectId", equals: input.projectId } }, orderBy: { createdAt: "desc" }, take: 30 });
            const rows = snapshots.flatMap((snapshot) => {
                const settings = snapshot.settings && typeof snapshot.settings === "object" && !Array.isArray(snapshot.settings) ? snapshot.settings : {};
                if (settings.country !== input.country)
                    return [];
                return [{ ...settings, snapshotId: snapshot.id, observedAt: snapshot.createdAt, source: "DataForSEO Labs Domain Rank Overview", confidence: "PROVIDER_ESTIMATE" }];
            });
            const observedAt = rows[0]?.observedAt;
            setSection(section, rows, "saved DataForSEO Labs domain estimates", "PROVIDER_ESTIMATE", observedAt instanceof Date || typeof observedAt === "string" ? observedAt : null, `Market ${input.country}. Uses saved estimates only; report generation does not make a paid provider request. Traffic figures are modeled estimates, not first-party analytics.`);
        }
    }
    return { generatedAt: new Date().toISOString(), project: { id: input.projectId, domain: domain.host }, market: input.country, device: input.device, sections };
}
