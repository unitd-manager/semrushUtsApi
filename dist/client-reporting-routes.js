import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "./db.js";
import { requireAuth } from "./auth.js";
import { collectClientReportData, generateEvidenceCommentary } from "./client-report-data.js";
import { clientReportFrequencies, clientReportSectionKeys, defaultReportSections, nextReportScheduleAt, previousCompletedPeriod, renderClientReportPdf } from "./client-reporting.js";
import { deliverClientReportEmail, ReportEmailFailure } from "./report-email.js";
import { getWorkspaceProviderCredentials } from "./workspace-integrations.js";
export const clientReportingRouter = Router();
const periodDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const idSchema = z.object({ id: z.string().min(1).max(191) });
const optionalText = (max) => z.string().trim().max(max).nullable().optional();
function statusError(status, code, message) { return Object.assign(new Error(message), { status, code }); }
function getError(error, res, next) {
    if (error instanceof z.ZodError) {
        res.status(400).json({ error: { code: "validation_error", message: "Check the submitted fields.", fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) } });
        return;
    }
    if (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
        const item = error;
        res.status(item.status).json({ error: { code: item.code ?? "client_report_request_failed", message: item.message ?? "The client report request could not be completed." } });
        return;
    }
    next(error);
}
function parsePeriod(start, end) { const from = new Date(`${start}T00:00:00.000Z`); const to = new Date(`${end}T23:59:59.999Z`); if (from > to || to > new Date())
    throw statusError(400, "invalid_reporting_period", "Choose an ordered reporting range ending today or earlier."); return { start: from, end: to }; }
function reportPeriodLabel(report) { return `${report.reportingPeriodStart.toISOString().slice(0, 10)} to ${report.reportingPeriodEnd.toISOString().slice(0, 10)}`; }
function publicUrl(token) { return `${(process.env.WEB_ORIGIN ?? "http://localhost:3000").replace(/\/$/u, "")}/client-report/${token}`; }
function newShareToken() { const token = randomBytes(32).toString("base64url"); return { token, hash: createHash("sha256").update(token).digest("hex") }; }
function safeInt(value, fallback) { return typeof value === "number" && Number.isInteger(value) ? value : fallback; }
async function scopedClient(organizationId, id) {
    const client = await prisma.clientReportClient.findFirst({ where: { id, organizationId }, include: { websites: { include: { domain: { select: { id: true, host: true, projectId: true } }, project: { select: { id: true, name: true } } } }, lead: { select: { id: true, businessName: true, website: true, email: true } } } });
    if (!client)
        throw statusError(404, "report_client_not_found", "Reporting client was not found in this workspace.");
    return client;
}
async function scopedTemplate(organizationId, id, clientId) {
    const template = await prisma.clientReportTemplate.findFirst({ where: { id, organizationId, ...(clientId ? { OR: [{ clientId }, { clientId: null }] } : {}) }, include: { sections: { orderBy: { position: "asc" } } } });
    if (!template)
        throw statusError(404, "report_template_not_found", "Report template was not found in this workspace or client.");
    return template;
}
function sectionStatus(ok, missing) { return { status: ok ? "available" : "no_data", note: ok ? "Evidence from selected SEO services; dates and freshness appear below." : missing }; }
function makeDocumentSections(collected, commentary, branding, client, template) {
    const sites = collected.sections;
    const enabled = new Map(template.sections.filter((section) => section.enabled).map((section) => [section.sectionKey, section]));
    const siteRows = (select) => sites.flatMap((site) => select(site).map((row) => ({ website: site.website.host, ...row })));
    const availableGsc = sites.filter((site) => site.searchConsole.current.status === "available");
    const availableGa4 = sites.filter((site) => site.analytics.current.status === "available");
    const sumAvailable = (rows, get) => rows.length ? rows.reduce((sum, site) => sum + (get(site) ?? 0), 0) : null;
    const sections = {};
    const add = (key, status, rows = [], metrics = {}, source, confidence, observedAt, note, body) => {
        const config = enabled.get(key);
        if (!config)
            return;
        sections[key] = { title: config.title, status: status.status, rows, metrics, source: source ?? "workspace records", confidence: confidence ?? "UNAVAILABLE", observedAt: observedAt ?? null, note: note ?? status.note, body: body ?? config.customText ?? null };
    };
    add("executive_summary", sectionStatus(true, ""), [], {}, commentary.mode === "openai_structured" ? "OpenAI structured commentary" : "evidence summary", commentary.mode === "openai_structured" ? "AI_EVIDENCE_GROUNDED" : "FIRST_PARTY", collected.generatedAt, "Commentary is a reviewable synthesis; supporting measurements are retained by section.", commentary.executiveSummary);
    const comparisonRows = sites.flatMap((site) => {
        const metrics = [
            ...Object.entries(site.searchConsole.comparisons ?? {}).map(([key, value]) => ({ metric: `Search Console ${key}`, ...value })),
            ...Object.entries(site.analytics.comparisons ?? {}).map(([key, value]) => ({ metric: `GA4 ${key}`, ...value })),
        ];
        return metrics.map((metric) => ({ website: site.website.host, ...metric }));
    });
    add("performance_analysis", sectionStatus(comparisonRows.length > 0, "Choose a comparison period and connect a matching Google property to see measured changes."), comparisonRows, {}, "GSC and GA4 period comparisons", "FIRST_PARTY", collected.generatedAt, "Changes compare the selected reporting and comparison periods. GSC clicks and GA4 sessions are separate measurements; percentage change is unavailable when the baseline is zero.");
    add("seo_overview", sectionStatus(sites.length > 0, "No reporting websites selected."), sites.map((site) => ({ website: site.website.host, searchClicks: site.searchConsole.current.metrics?.clicks ?? null, organicSessions: site.analytics.current.metrics?.sessions ?? null, rankingKeywords: site.rankings.rows.length, technicalIssues: site.technical.currentIssueCount })), {}, "GSC, GA4, rank tracking, Site Audit", "MIXED", collected.generatedAt, "GSC clicks and GA4 organic sessions use different definitions and are shown separately.");
    const gscImpressions = sumAvailable(availableGsc, (site) => site.searchConsole.current.metrics?.impressions);
    const gscClicks = sumAvailable(availableGsc, (site) => site.searchConsole.current.metrics?.clicks);
    const gscCtr = gscImpressions ? availableGsc.reduce((sum, site) => sum + (site.searchConsole.current.metrics?.ctr ?? 0) * (site.searchConsole.current.metrics?.impressions ?? 0), 0) / gscImpressions : null;
    const gscPosition = gscImpressions ? availableGsc.reduce((sum, site) => sum + (site.searchConsole.current.metrics?.averagePosition ?? 0) * (site.searchConsole.current.metrics?.impressions ?? 0), 0) / gscImpressions : null;
    add("gsc", sectionStatus(availableGsc.length > 0, "Google Search Console is not connected for a matching site property."), siteRows((site) => site.searchConsole.current.metrics?.topQueries ?? []), { clicks: gscClicks, impressions: gscImpressions, ctr: gscCtr, averagePosition: gscPosition }, "Google Search Console API", "FIRST_PARTY", collected.generatedAt, `${availableGsc.length} of ${sites.length} website properties available. Queries are aggregated from connected properties; low-volume rows may be omitted by Google.`);
    add("ga4", sectionStatus(availableGa4.length > 0, "GA4 is not connected for these report websites."), siteRows((site) => site.analytics.current.metrics?.landingPages ?? []), { sessions: sumAvailable(availableGa4, (site) => site.analytics.current.metrics?.sessions), users: sumAvailable(availableGa4, (site) => site.analytics.current.metrics?.users), conversions: sumAvailable(availableGa4, (site) => site.analytics.current.metrics?.conversions), revenue: sumAvailable(availableGa4, (site) => site.analytics.current.metrics?.revenue) }, "Google Analytics 4 API", "FIRST_PARTY", collected.generatedAt, `${availableGa4.length} of ${sites.length} website properties available. Only organic session-medium rows are included. GA4 conversion and revenue definitions follow the selected property configuration.`);
    const rankedSites = sites.filter((site) => site.rankings.rows.length > 0);
    add("rankings", sectionStatus(rankedSites.length > 0, "No ranking observations were saved for this period."), siteRows((site) => [...site.rankings.winners, ...site.rankings.decliners]), { top3: sumAvailable(rankedSites, (site) => site.rankings.topThree), top10: sumAvailable(rankedSites, (site) => site.rankings.topTen), top20: sumAvailable(rankedSites, (site) => site.rankings.topTwenty) }, "saved rank snapshots", rankedSites.length ? "PROVIDER_OBSERVED" : "UNAVAILABLE", collected.generatedAt, `${rankedSites.length} of ${sites.length} websites have observations. Ranking movement compares provider observations for matching keyword, market, and device.`);
    add("landing_pages", sectionStatus(sites.some((site) => site.analytics.current.metrics?.landingPages?.length), "GA4 landing-page data is unavailable."), siteRows((site) => site.analytics.current.metrics?.landingPages ?? []), {}, "GA4 landingPage dimension", "FIRST_PARTY", collected.generatedAt);
    const auditedSites = sites.filter((site) => site.technical.latestCrawl);
    add("technical_audit", sectionStatus(auditedSites.length > 0, "No crawler audit is available."), siteRows((site) => site.technical.unresolved.slice(0, 100)), { issues: sumAvailable(auditedSites, (site) => site.technical.currentIssueCount), critical: sumAvailable(auditedSites, (site) => site.technical.criticalIssues), highPriority: sumAvailable(auditedSites, (site) => site.technical.highPriorityIssues), newlyDetected: sumAvailable(auditedSites, (site) => site.technical.newlyDetected), resolved: sumAvailable(auditedSites, (site) => site.technical.resolvedSinceBaseline) }, "first-party crawler", "FIRST_PARTY", collected.generatedAt, `${auditedSites.length} of ${sites.length} websites have a crawl audit.`);
    add("daily_briefing", sectionStatus(sites.some((site) => site.dailyBriefing), "No Daily SEO Briefing snapshot exists for this reporting period."), siteRows((site) => [...(site.dailyBriefing?.content?.priorities ?? []), ...(site.dailyBriefing?.content?.signals ?? [])]), {}, "saved Daily SEO Briefing snapshots", sites.some((site) => site.dailyBriefing) ? "FIRST_PARTY" : "UNAVAILABLE", collected.generatedAt, "Briefing priorities and signals are included as dated workspace observations.");
    add("backlinks", sectionStatus(sites.some((site) => site.backlinks.current), "No provider backlink snapshot exists for this period."), [], {}, "configured backlink provider snapshots", sites[0]?.backlinks.confidence, collected.generatedAt, sites.map((site) => `${site.website.host}: ${site.backlinks.note}`).join(" "));
    add("competitors", sectionStatus(sites.some((site) => site.competitors.rows.length), "No competitor snapshot exists for this period."), siteRows((site) => site.competitors.rows), {}, "saved competitor snapshots", "PROVIDER_ESTIMATE", collected.generatedAt, "Competitor traffic and visibility totals are provider estimates where present.");
    add("completed_work", sectionStatus(sites.some((site) => site.completedWork.tasks.length || site.completedWork.verifiedSeoFixes.length), "No completed tasks or verified SEO fixes were recorded in this period."), siteRows((site) => [...site.completedWork.tasks.map((task) => ({ ...task, workType: "Completed project task" })), ...site.completedWork.verifiedSeoFixes]), {}, "completed task records and VERIFIED fix executions", "FIRST_PARTY", collected.generatedAt);
    add("outstanding_issues", sectionStatus(sites.some((site) => site.technical.unresolved.length), "No unresolved issues are recorded in the latest audit."), siteRows((site) => site.technical.unresolved), {}, "latest Site Audit issue records", "FIRST_PARTY", collected.generatedAt);
    add("opportunities", sectionStatus(commentary.nextPeriodPriorities.length > 0, "No evidence-supported priorities could be prepared."), commentary.nextPeriodPriorities, {}, "AI or evidence-based recommendations", commentary.mode === "openai_structured" ? "AI_EVIDENCE_GROUNDED" : "FIRST_PARTY", collected.generatedAt);
    add("next_period_strategy", sectionStatus(commentary.nextPeriodPriorities.length > 0, "No next-period recommendations available."), commentary.nextPeriodPriorities, {}, "AI or evidence summary", commentary.mode === "openai_structured" ? "AI_EVIDENCE_GROUNDED" : "FIRST_PARTY", collected.generatedAt);
    add("client_commentary", sectionStatus(true, ""), [], {}, "agency-entered commentary", "USER_ENTERED", collected.generatedAt);
    add("contact", sectionStatus(true, ""), [], {}, branding.agencyName, "USER_ENTERED", null, "Agency contact information", [branding.contactName, branding.contactEmail, branding.contactPhone, branding.websiteUrl, branding.address].filter(Boolean).join(" · "));
    return { generatedAt: collected.generatedAt, currentPeriod: collected.currentPeriod, comparisonPeriod: collected.comparisonPeriod, timezone: collected.timezone, attribution: { gsc: "Search clicks", ga4: "Organic session medium; property-level attribution configuration" }, websites: sites.map((site) => site.website), sources: sites.map((site) => ({ website: site.website.host, ...site.sources })), sections };
}
async function loadReport(organizationId, id) {
    const report = await prisma.clientReport.findFirst({ where: { id, organizationId }, include: { client: true, template: { include: { sections: { orderBy: { position: "asc" } } } }, websites: { include: { domain: { select: { id: true, host: true } }, project: { select: { id: true, name: true } } } }, approvals: { orderBy: { reviewedAt: "desc" } }, deliveries: { orderBy: { createdAt: "desc" } }, generationLogs: { orderBy: { createdAt: "desc" }, take: 10 } } });
    if (!report)
        throw statusError(404, "client_report_not_found", "Report was not found in this workspace.");
    return report;
}
async function buildAndSaveReport(input) {
    const client = await scopedClient(input.organizationId, input.clientId);
    const template = await scopedTemplate(input.organizationId, input.templateId, client.id);
    if (input.websiteIds.length < 1 || new Set(input.websiteIds).size !== input.websiteIds.length)
        throw statusError(400, "report_websites_required", "Select one or more distinct client websites.");
    const mapped = client.websites.filter((entry) => input.websiteIds.includes(entry.domainId)).map((entry) => ({ domainId: entry.domainId, projectId: entry.projectId, host: entry.domain.host }));
    if (mapped.length !== input.websiteIds.length)
        throw statusError(403, "client_website_forbidden", "A selected website is not connected to this client in the active workspace.");
    const current = { start: input.start, end: input.end };
    const comparison = input.comparisonStart && input.comparisonEnd ? { start: input.comparisonStart, end: input.comparisonEnd } : null;
    const collected = await collectClientReportData(prisma, input.organizationId, mapped, current, comparison, input.timezone);
    const commentary = await generateEvidenceCommentary(collected, input.organizationId);
    const branding = await prisma.clientReportBranding.findUnique({ where: { organizationId: input.organizationId } }) ?? { agencyName: "SEO Agency" };
    const dataSnapshot = makeDocumentSections(collected, commentary, branding, client, template);
    const reportingPeriodStart = new Date(Date.UTC(input.start.getUTCFullYear(), input.start.getUTCMonth(), input.start.getUTCDate()));
    const reportingPeriodEnd = new Date(Date.UTC(input.end.getUTCFullYear(), input.end.getUTCMonth(), input.end.getUTCDate()));
    const share = newShareToken();
    const title = `${client.name} SEO Report — ${reportingPeriodStart.toISOString().slice(0, 7)}`;
    const saved = await prisma.$transaction(async (tx) => {
        const report = await tx.clientReport.create({ data: { organizationId: input.organizationId, clientId: client.id, templateId: template.id, scheduleId: input.scheduleId ?? null, title, reportingPeriodStart, reportingPeriodEnd, comparisonPeriodStart: input.comparisonStart ?? null, comparisonPeriodEnd: input.comparisonEnd ?? null, timezone: input.timezone, status: "AWAITING_REVIEW", dataSnapshot: dataSnapshot, commentary: commentary, manualNotes: input.manualNotes ?? null, accessTokenHash: share.hash, accessExpiresAt: new Date(Date.now() + 60 * 86400000), createdById: input.userId } });
        await tx.clientReportIncludedWebsite.createMany({ data: mapped.map((website) => ({ reportId: report.id, domainId: website.domainId, projectId: website.projectId })) });
        await tx.clientReportDataSnapshot.create({ data: { reportId: report.id, sourceMap: dataSnapshot.sources, freshness: Object.fromEntries(collected.sections.map((site) => [site.website.host, { generatedAt: collected.generatedAt, sources: site.sources }])) } });
        await tx.clientReportGenerationLog.create({ data: { reportId: report.id, status: "GENERATED", message: "Collected current and comparison data, validated source coverage, and prepared commentary for review.", details: { websiteCount: mapped.length, commentaryMode: commentary.mode, generatedAt: collected.generatedAt } } });
        await tx.activityLog.create({ data: { organizationId: input.organizationId, userId: input.userId, action: "client_report.generated", entityType: "ClientReport", entityId: report.id, metadata: { clientId: client.id, websiteIds: input.websiteIds, periodStart: reportingPeriodStart, periodEnd: reportingPeriodEnd } } });
        return report;
    });
    return { report: await loadReport(input.organizationId, saved.id), shareUrl: publicUrl(share.token) };
}
function pdfFor(report, branding) { return renderClientReportPdf({ snapshot: report.dataSnapshot, commentary: report.commentary, manualNotes: report.manualNotes, client: { name: report.client.name }, title: report.title, period: reportPeriodLabel(report), branding: branding ?? { agencyName: "SEO Agency" } }); }
clientReportingRouter.get("/dashboard", requireAuth, async (req, res, next) => {
    try {
        const organizationId = req.auth.organizationId;
        const start = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
        const [clients, websites, reportsThisMonth, schedules, awaitingReview, delivered, failed, recent, upcoming, emailConfigured] = await Promise.all([
            prisma.clientReportClient.count({ where: { organizationId, isActive: true } }), prisma.clientReportWebsite.count({ where: { client: { organizationId, isActive: true } } }), prisma.clientReport.count({ where: { organizationId, generatedAt: { gte: start } } }), prisma.clientReportSchedule.count({ where: { organizationId, isActive: true } }), prisma.clientReport.count({ where: { organizationId, status: "AWAITING_REVIEW" } }), prisma.clientReportDelivery.count({ where: { organizationId, status: "ACCEPTED" } }), prisma.clientReportDelivery.count({ where: { organizationId, status: { in: ["FAILED", "UNKNOWN"] } } }), prisma.clientReport.findMany({ where: { organizationId }, orderBy: { generatedAt: "desc" }, take: 8, include: { client: { select: { name: true } }, deliveries: { orderBy: { createdAt: "desc" }, take: 1 } } }), prisma.clientReportSchedule.findMany({ where: { organizationId, isActive: true, nextRunAt: { not: null } }, orderBy: { nextRunAt: "asc" }, take: 8, include: { client: { select: { name: true } }, template: { select: { name: true } } } }), Boolean(process.env.RESEND_API_KEY?.trim() && process.env.REPORT_EMAIL_FROM?.trim()),
        ]);
        const [emailCredentials, ai] = await Promise.all([getWorkspaceProviderCredentials(organizationId, "resend"), getWorkspaceProviderCredentials(organizationId, "openai")]);
        res.json({ data: { clients, websites, reportsThisMonth, schedules, awaitingReview, delivered, failed, recent, upcoming, emailConfigured: Boolean(emailCredentials.apiKey?.trim() && emailCredentials.from?.trim()), aiConfigured: Boolean(ai.apiKey?.trim()) } });
    }
    catch (error) {
        getError(error, res, next);
    }
});
clientReportingRouter.get("/clients", requireAuth, async (req, res, next) => {
    try {
        const query = z.object({ q: z.string().trim().max(100).optional(), offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
        const where = { organizationId: req.auth.organizationId, isActive: true, ...(query.q ? { OR: [{ name: { contains: query.q } }, { email: { contains: query.q } }] } : {}) };
        const [total, data] = await Promise.all([prisma.clientReportClient.count({ where }), prisma.clientReportClient.findMany({ where, orderBy: { name: "asc" }, skip: query.offset, take: query.limit, include: { lead: { select: { id: true, website: true, stage: true } }, websites: { include: { domain: { select: { id: true, host: true } }, project: { select: { id: true, name: true } } } }, _count: { select: { reports: true, schedules: true } } } })]);
        res.json({ data, pagination: { total, offset: query.offset, limit: query.limit, hasMore: query.offset + data.length < total } });
    }
    catch (error) {
        getError(error, res, next);
    }
});
clientReportingRouter.post("/clients", requireAuth, async (req, res, next) => {
    try {
        const input = z.object({ name: z.string().trim().min(2).max(160), leadId: z.string().min(1).optional(), email: z.string().email().max(254).optional().nullable(), website: z.string().url().max(500).optional().nullable(), timezone: z.string().trim().min(1).max(64).default("UTC"), notes: optionalText(3000) }).parse(req.body);
        try {
            new Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
        }
        catch {
            throw statusError(400, "invalid_timezone", "Choose a valid IANA timezone.");
        }
        if (input.leadId && !await prisma.lead.findFirst({ where: { id: input.leadId, organizationId: req.auth.organizationId }, select: { id: true } }))
            throw statusError(404, "crm_lead_not_found", "CRM record was not found in this workspace.");
        const data = await prisma.clientReportClient.create({ data: { organizationId: req.auth.organizationId, ...input } });
        res.status(201).json({ data, note: input.leadId ? "Linked this reporting profile to the existing CRM record." : "Created a reporting client profile." });
    }
    catch (error) {
        getError(error, res, next);
    }
});
clientReportingRouter.patch("/clients/:id", requireAuth, async (req, res, next) => {
    try {
        const { id } = idSchema.parse(req.params);
        const input = z.object({ name: z.string().trim().min(2).max(160).optional(), email: z.string().email().max(254).nullable().optional(), website: z.string().url().max(500).nullable().optional(), timezone: z.string().trim().min(1).max(64).optional(), notes: optionalText(3000), isActive: z.boolean().optional() }).parse(req.body);
        if (input.timezone) {
            try {
                new Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
            }
            catch {
                throw statusError(400, "invalid_timezone", "Choose a valid IANA timezone.");
            }
        }
        const updated = await prisma.clientReportClient.updateMany({ where: { id, organizationId: req.auth.organizationId }, data: input });
        if (!updated.count)
            throw statusError(404, "report_client_not_found", "Reporting client was not found.");
        res.json({ data: await scopedClient(req.auth.organizationId, id) });
    }
    catch (error) {
        getError(error, res, next);
    }
});
clientReportingRouter.post("/clients/:id/websites", requireAuth, async (req, res, next) => {
    try {
        const { id } = idSchema.parse(req.params);
        await scopedClient(req.auth.organizationId, id);
        const input = z.object({ websites: z.array(z.object({ projectId: z.string().min(1), domainId: z.string().min(1) }).strict()).min(1).max(30) }).parse(req.body);
        if (new Set(input.websites.map((x) => x.domainId)).size !== input.websites.length)
            throw statusError(400, "duplicate_websites", "Select each website once.");
        for (const website of input.websites)
            if (!await prisma.domain.findFirst({ where: { id: website.domainId, projectId: website.projectId, organizationId: req.auth.organizationId }, select: { id: true } }))
                throw statusError(404, "website_not_found", "A selected website does not belong to this workspace project.");
        await prisma.$transaction(input.websites.map((website) => prisma.clientReportWebsite.upsert({ where: { clientId_domainId: { clientId: id, domainId: website.domainId } }, create: { clientId: id, ...website }, update: { projectId: website.projectId } })));
        res.status(201).json({ data: await scopedClient(req.auth.organizationId, id) });
    }
    catch (error) {
        getError(error, res, next);
    }
});
clientReportingRouter.get("/crm-leads", requireAuth, async (req, res, next) => {
    try {
        const leads = await prisma.lead.findMany({ where: { organizationId: req.auth.organizationId, stage: "WON" }, orderBy: { businessName: "asc" }, take: 200, select: { id: true, businessName: true, website: true, email: true, stage: true } });
        res.json({ data: leads, note: "Only existing CRM records marked WON are offered as client links. Reporting client profiles do not duplicate lead records when linked." });
    }
    catch (error) {
        getError(error, res, next);
    }
});
clientReportingRouter.get("/templates", requireAuth, async (req, res, next) => {
    try {
        const query = z.object({ clientId: z.string().optional() }).parse(req.query);
        if (query.clientId)
            await scopedClient(req.auth.organizationId, query.clientId);
        const data = await prisma.clientReportTemplate.findMany({ where: { organizationId: req.auth.organizationId, ...(query.clientId ? { OR: [{ clientId: query.clientId }, { clientId: null }] } : {}) }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], include: { client: { select: { id: true, name: true } }, sections: { orderBy: { position: "asc" } }, _count: { select: { reports: true, schedules: true } } } });
        res.json({ data, availableSections: clientReportSectionKeys, defaultSections: defaultReportSections });
    }
    catch (error) {
        getError(error, res, next);
    }
});
const templateInput = z.object({ name: z.string().trim().min(2).max(120), description: optionalText(1000), clientId: z.string().nullable().optional(), isDefault: z.boolean().optional(), sections: z.array(z.object({ sectionKey: z.enum(clientReportSectionKeys), title: z.string().trim().min(2).max(100), position: z.number().int().min(0).max(50), enabled: z.boolean(), customText: optionalText(4000), configuration: z.record(z.string(), z.unknown()).nullable().optional() }).strict()).min(1).max(30) }).superRefine((input, ctx) => { if (new Set(input.sections.map((section) => section.sectionKey)).size !== input.sections.length)
    ctx.addIssue({ code: "custom", path: ["sections"], message: "Use each section type once in a template." }); });
clientReportingRouter.post("/templates", requireAuth, async (req, res, next) => {
    try {
        if (!["OWNER", "ADMIN", "MANAGER"].includes(req.auth.role))
            throw statusError(403, "report_template_role_required", "An owner, admin, or manager is required to edit report templates.");
        const input = templateInput.parse(req.body);
        if (input.clientId)
            await scopedClient(req.auth.organizationId, input.clientId);
        const { sections, ...fields } = input;
        const data = await prisma.$transaction(async (tx) => {
            if (fields.isDefault)
                await tx.clientReportTemplate.updateMany({ where: { organizationId: req.auth.organizationId }, data: { isDefault: false } });
            return tx.clientReportTemplate.create({ data: { organizationId: req.auth.organizationId, ...fields, sections: { create: sections.map((section) => ({ ...section, configuration: section.configuration })) } }, include: { sections: { orderBy: { position: "asc" } } } });
        });
        res.status(201).json({ data });
    }
    catch (error) {
        getError(error, res, next);
    }
});
clientReportingRouter.patch("/templates/:id", requireAuth, async (req, res, next) => {
    try {
        if (!["OWNER", "ADMIN", "MANAGER"].includes(req.auth.role))
            throw statusError(403, "report_template_role_required", "An owner, admin, or manager is required to edit report templates.");
        const { id } = idSchema.parse(req.params);
        const input = templateInput.partial().parse(req.body);
        const current = await prisma.clientReportTemplate.findFirst({ where: { id, organizationId: req.auth.organizationId } });
        if (!current)
            throw statusError(404, "report_template_not_found", "Template was not found.");
        if (input.clientId)
            await scopedClient(req.auth.organizationId, input.clientId);
        const { sections, ...fields } = input;
        const data = await prisma.$transaction(async (tx) => {
            if (fields.isDefault)
                await tx.clientReportTemplate.updateMany({ where: { organizationId: req.auth.organizationId, id: { not: id } }, data: { isDefault: false } });
            await tx.clientReportTemplate.update({ where: { id }, data: fields });
            if (sections) {
                await tx.clientReportSection.deleteMany({ where: { templateId: id } });
                await tx.clientReportSection.createMany({ data: sections.map((section) => ({ templateId: id, ...section, configuration: section.configuration })) });
            }
            return tx.clientReportTemplate.findUniqueOrThrow({ where: { id }, include: { sections: { orderBy: { position: "asc" } } } });
        });
        res.json({ data });
    }
    catch (error) {
        getError(error, res, next);
    }
});
clientReportingRouter.delete("/templates/:id", requireAuth, async (req, res, next) => {
    try {
        if (!["OWNER", "ADMIN"].includes(req.auth.role))
            throw statusError(403, "report_template_role_required", "An owner or admin is required to delete templates.");
        const { id } = idSchema.parse(req.params);
        const result = await prisma.clientReportTemplate.deleteMany({ where: { id, organizationId: req.auth.organizationId, reports: { none: {} }, schedules: { none: {} } } });
        if (!result.count)
            throw statusError(409, "template_in_use", "Template was not found or is assigned to a report or schedule.");
        res.status(204).end();
    }
    catch (error) {
        getError(error, res, next);
    }
});
clientReportingRouter.get("/branding", requireAuth, async (req, res, next) => {
    try {
        const data = await prisma.clientReportBranding.findUnique({ where: { organizationId: req.auth.organizationId } });
        res.json({ data });
    }
    catch (error) {
        getError(error, res, next);
    }
});
clientReportingRouter.patch("/branding", requireAuth, async (req, res, next) => {
    try {
        if (!["OWNER", "ADMIN", "MANAGER"].includes(req.auth.role))
            throw statusError(403, "branding_role_required", "An owner, admin, or manager is required to manage report branding.");
        const input = z.object({ agencyName: z.string().trim().min(2).max(160), logoUrl: z.string().url().max(500).nullable().optional(), primaryColor: z.string().regex(/^#[0-9a-f]{6}$/iu).default("#157d70"), secondaryColor: z.string().regex(/^#[0-9a-f]{6}$/iu).default("#173b3c"), contactName: optionalText(160), contactEmail: z.string().email().max(254).nullable().optional(), contactPhone: optionalText(80), websiteUrl: z.string().url().max(500).nullable().optional(), address: optionalText(1000), disclaimer: optionalText(2000), copyrightText: optionalText(300) }).parse(req.body);
        if (input.logoUrl && new URL(input.logoUrl).protocol !== "https:")
            throw statusError(400, "invalid_logo_url", "Agency logo URL must use HTTPS.");
        const data = await prisma.clientReportBranding.upsert({ where: { organizationId: req.auth.organizationId }, create: { organizationId: req.auth.organizationId, ...input }, update: input });
        res.json({ data });
    }
    catch (error) {
        getError(error, res, next);
    }
});
clientReportingRouter.get("/reports", requireAuth, async (req, res, next) => {
    try {
        const query = z.object({ clientId: z.string().optional(), status: z.string().optional(), q: z.string().trim().max(120).optional(), offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(100).default(25) }).parse(req.query);
        const where = { organizationId: req.auth.organizationId, ...(query.clientId ? { clientId: query.clientId } : {}), ...(query.status ? { status: query.status } : {}), ...(query.q ? { OR: [{ title: { contains: query.q } }, { client: { name: { contains: query.q } } }] } : {}) };
        const [total, data] = await Promise.all([prisma.clientReport.count({ where }), prisma.clientReport.findMany({ where, orderBy: { generatedAt: "desc" }, skip: query.offset, take: query.limit, include: { client: { select: { id: true, name: true } }, template: { select: { id: true, name: true } }, websites: { include: { domain: { select: { id: true, host: true } } } }, approvals: { orderBy: { reviewedAt: "desc" }, take: 1 }, deliveries: { orderBy: { createdAt: "desc" }, take: 1 } } })]);
        res.json({ data, pagination: { total, offset: query.offset, limit: query.limit, hasMore: query.offset + data.length < total } });
    }
    catch (error) {
        getError(error, res, next);
    }
});
clientReportingRouter.post("/reports/generate", requireAuth, async (req, res, next) => {
    try {
        if (!["OWNER", "ADMIN", "MANAGER", "ANALYST"].includes(req.auth.role))
            throw statusError(403, "report_generation_forbidden", "Your role cannot generate client reports.");
        const input = z.object({ clientId: z.string().min(1), templateId: z.string().min(1), websiteIds: z.array(z.string().min(1)).min(1).max(20), periodStart: periodDate, periodEnd: periodDate, comparisonStart: periodDate.optional(), comparisonEnd: periodDate.optional(), timezone: z.string().trim().min(1).max(64).optional(), manualNotes: optionalText(6000) }).superRefine((x, ctx) => { if (Boolean(x.comparisonStart) !== Boolean(x.comparisonEnd))
            ctx.addIssue({ code: "custom", path: ["comparisonEnd"], message: "Provide both comparison period dates." }); }).parse(req.body);
        const period = parsePeriod(input.periodStart, input.periodEnd);
        const comparison = input.comparisonStart ? parsePeriod(input.comparisonStart, input.comparisonEnd) : null;
        if (comparison && comparison.end >= period.start)
            throw statusError(400, "overlapping_periods", "Comparison dates must end before the reporting period begins.");
        const client = await scopedClient(req.auth.organizationId, input.clientId);
        const result = await buildAndSaveReport({ organizationId: req.auth.organizationId, userId: req.auth.userId, clientId: input.clientId, templateId: input.templateId, websiteIds: input.websiteIds, start: period.start, end: period.end, comparisonStart: comparison?.start, comparisonEnd: comparison?.end, timezone: input.timezone ?? client.timezone, manualNotes: input.manualNotes });
        res.status(201).json({ data: result.report, shareUrl: result.shareUrl, note: "Report prepared from saved and connected source evidence and placed in review. No email was sent." });
    }
    catch (error) {
        getError(error, res, next);
    }
});
clientReportingRouter.get("/reports/:id", requireAuth, async (req, res, next) => {
    try {
        const { id } = idSchema.parse(req.params);
        const report = await loadReport(req.auth.organizationId, id);
        const branding = await prisma.clientReportBranding.findUnique({ where: { organizationId: req.auth.organizationId } });
        res.json({ data: report, branding, shareActive: Boolean(report.accessTokenHash && !report.accessRevokedAt && report.accessExpiresAt && report.accessExpiresAt > new Date()) });
    }
    catch (error) {
        getError(error, res, next);
    }
});
clientReportingRouter.patch("/reports/:id", requireAuth, async (req, res, next) => {
    try {
        const { id } = idSchema.parse(req.params);
        const report = await loadReport(req.auth.organizationId, id);
        if (!["GENERATED", "AWAITING_REVIEW", "CHANGES_REQUESTED"].includes(report.status))
            throw statusError(409, "report_not_editable", "Only draft and review reports can be edited.");
        const input = z.object({ commentary: z.record(z.string(), z.unknown()).optional(), manualNotes: optionalText(6000), sectionVisibility: z.record(z.string(), z.boolean()).optional() }).parse(req.body);
        let snapshot = report.dataSnapshot;
        if (input.sectionVisibility)
            snapshot = { ...snapshot, sections: Object.fromEntries(Object.entries(snapshot.sections ?? {}).map(([key, value]) => [key, { ...value, hidden: input.sectionVisibility[key] === false }])) };
        const data = await prisma.clientReport.update({ where: { id }, data: { ...(input.commentary ? { commentary: input.commentary } : {}), ...(input.manualNotes !== undefined ? { manualNotes: input.manualNotes } : {}), ...(input.sectionVisibility ? { dataSnapshot: snapshot } : {}), status: "AWAITING_REVIEW" } });
        await prisma.activityLog.create({ data: { organizationId: req.auth.organizationId, userId: req.auth.userId, action: "client_report.edited", entityType: "ClientReport", entityId: id, metadata: { hasCommentaryEdit: Boolean(input.commentary), hasManualNotes: input.manualNotes !== undefined, sectionVisibilityChanged: Boolean(input.sectionVisibility) } } });
        res.json({ data });
    }
    catch (error) {
        getError(error, res, next);
    }
});
clientReportingRouter.post("/reports/:id/approve", requireAuth, async (req, res, next) => {
    try {
        if (!["OWNER", "ADMIN", "MANAGER"].includes(req.auth.role))
            throw statusError(403, "report_approval_forbidden", "An owner, admin, or manager must approve client reports.");
        const { id } = idSchema.parse(req.params);
        const report = await loadReport(req.auth.organizationId, id);
        if (!["AWAITING_REVIEW", "CHANGES_REQUESTED", "GENERATED"].includes(report.status))
            throw statusError(409, "report_not_approvable", "This report is not awaiting review.");
        const approval = await prisma.$transaction(async (tx) => { const value = await tx.clientReportApproval.create({ data: { reportId: id, status: "APPROVED", reviewedById: req.auth.userId, comments: z.object({ comments: optionalText(2000) }).parse(req.body).comments } }); const updated = await tx.clientReport.update({ where: { id }, data: { status: "APPROVED", approvedAt: new Date() } }); await tx.activityLog.create({ data: { organizationId: req.auth.organizationId, userId: req.auth.userId, action: "client_report.approved", entityType: "ClientReport", entityId: id } }); return { approval: value, report: updated }; });
        res.json({ data: approval, note: "Report approved. Delivery still requires a separate send action or explicitly enabled schedule." });
    }
    catch (error) {
        getError(error, res, next);
    }
});
clientReportingRouter.post("/reports/:id/reject", requireAuth, async (req, res, next) => {
    try {
        if (!["OWNER", "ADMIN", "MANAGER"].includes(req.auth.role))
            throw statusError(403, "report_approval_forbidden", "An owner, admin, or manager must review client reports.");
        const { id } = idSchema.parse(req.params);
        const report = await loadReport(req.auth.organizationId, id);
        if (!["AWAITING_REVIEW", "GENERATED"].includes(report.status))
            throw statusError(409, "report_not_rejectable", "This report is not awaiting review.");
        const input = z.object({ comments: z.string().trim().min(3).max(2000) }).parse(req.body);
        const approval = await prisma.clientReportApproval.create({ data: { reportId: id, status: "CHANGES_REQUESTED", reviewedById: req.auth.userId, comments: input.comments } });
        const data = await prisma.clientReport.update({ where: { id }, data: { status: "CHANGES_REQUESTED" } });
        res.json({ data: { approval, report: data } });
    }
    catch (error) {
        getError(error, res, next);
    }
});
async function deliverReport(organizationId, reportId, recipientInput, scheduledSlot, userId) {
    const report = await loadReport(organizationId, reportId);
    if (report.status !== "APPROVED")
        throw statusError(409, "report_approval_required", "Only an approved client report can be sent.");
    const recipients = [...new Set(recipientInput.map((email) => email.trim().toLowerCase()))];
    if (!recipients.length || recipients.length > 30)
        throw statusError(400, "report_recipient_invalid", "Provide between one and thirty unique recipients.");
    const branding = await prisma.clientReportBranding.findUnique({ where: { organizationId } }) ?? { agencyName: "SEO Agency" };
    const pdf = pdfFor(report, branding);
    const share = newShareToken();
    const updated = await prisma.clientReport.update({ where: { id: reportId }, data: { accessTokenHash: share.hash, accessExpiresAt: new Date(Date.now() + 60 * 86400000), accessRevokedAt: null } });
    const outcomes = await Promise.allSettled(recipients.map(async (recipient) => {
        const idempotencyKey = createHash("sha256").update(`${reportId}:${scheduledSlot}:${recipient}`).digest("hex");
        const prior = await prisma.clientReportDelivery.findUnique({ where: { idempotencyKey } });
        if (prior?.status === "ACCEPTED")
            return { recipient, status: "ACCEPTED", providerReference: prior.providerReference };
        const delivery = prior ?? await prisma.clientReportDelivery.create({ data: { organizationId, reportId, recipient, status: "SENDING", idempotencyKey } });
        await prisma.clientReportDelivery.update({ where: { id: delivery.id }, data: { status: "SENDING", errorMessage: null } });
        try {
            const provider = await deliverClientReportEmail({ reportId, title: report.title, agencyName: branding.agencyName, recipient, reportUrl: publicUrl(share.token), pdf, scheduledSlot, providerCredentials: await getWorkspaceProviderCredentials(organizationId, "resend") });
            await prisma.clientReportDelivery.update({ where: { id: delivery.id }, data: { status: "ACCEPTED", providerReference: provider.providerMessageId, sentAt: new Date() } });
            return { recipient, status: "ACCEPTED", providerReference: provider.providerMessageId };
        }
        catch (error) {
            const state = error instanceof ReportEmailFailure && error.code === "email_result_unknown" ? "UNKNOWN" : "FAILED";
            await prisma.clientReportDelivery.update({ where: { id: delivery.id }, data: { status: state, errorMessage: error instanceof Error ? error.message.slice(0, 1200) : "Provider delivery failed." } });
            throw Object.assign(error instanceof Error ? error : new Error("Provider delivery failed."), { deliveryStatus: state });
        }
    }));
    const successes = outcomes.filter((item) => item.status === "fulfilled").length;
    const failureOutcomes = outcomes.filter((item) => item.status === "rejected");
    const status = successes && !failureOutcomes.length ? "DELIVERED" : "DELIVERY_FAILED";
    await prisma.clientReport.update({ where: { id: reportId }, data: { status, deliveredAt: successes ? new Date() : undefined } });
    await prisma.activityLog.create({ data: { organizationId, userId, action: "client_report.delivery_attempted", entityType: "ClientReport", entityId: reportId, metadata: { recipientCount: recipients.length, accepted: successes, failed: failureOutcomes.length, status } } });
    return { report: await loadReport(organizationId, reportId), deliveryResults: outcomes.map((item, index) => item.status === "fulfilled" ? item.value : { recipient: recipients[index], status: "FAILED", message: item.reason instanceof Error ? item.reason.message : "Delivery failed." }), note: "Provider acceptance is recorded per recipient. It does not confirm inbox delivery or that a client viewed the report." };
}
clientReportingRouter.post("/reports/:id/deliver", requireAuth, async (req, res, next) => {
    try {
        if (!["OWNER", "ADMIN", "MANAGER"].includes(req.auth.role))
            throw statusError(403, "report_delivery_forbidden", "An owner, admin, or manager must send client reports.");
        const { id } = idSchema.parse(req.params);
        const input = z.object({ recipients: z.array(z.string().trim().email().max(254)).min(1).max(30).optional(), scheduledSlot: z.string().trim().min(1).max(100).optional() }).parse(req.body);
        const report = await loadReport(req.auth.organizationId, id);
        const recipients = input.recipients ?? (report.scheduleId ? (await prisma.clientReportSchedule.findFirst({ where: { id: report.scheduleId, organizationId: req.auth.organizationId }, include: { recipients: true } }))?.recipients.map((item) => item.email) : []);
        const outcome = await deliverReport(req.auth.organizationId, id, recipients ?? [], input.scheduledSlot ?? `${report.reportingPeriodStart.toISOString()}:${report.reportingPeriodEnd.toISOString()}`, req.auth.userId);
        res.status(outcome.report.status === "DELIVERED" ? 200 : 207).json({ data: outcome.report, deliveryResults: outcome.deliveryResults, note: outcome.note });
    }
    catch (error) {
        getError(error, res, next);
    }
});
clientReportingRouter.get("/reports/:id/pdf", requireAuth, async (req, res, next) => {
    try {
        const { id } = idSchema.parse(req.params);
        const report = await loadReport(req.auth.organizationId, id);
        const branding = await prisma.clientReportBranding.findUnique({ where: { organizationId: req.auth.organizationId } }) ?? { agencyName: "SEO Agency" };
        const pdf = pdfFor(report, branding);
        res.setHeader("content-type", "application/pdf");
        res.setHeader("content-disposition", `attachment; filename="${report.title.replace(/[^a-z0-9-_ ]/giu, "").replaceAll(" ", "-").slice(0, 100)}.pdf"`);
        res.send(Buffer.from(pdf));
    }
    catch (error) {
        getError(error, res, next);
    }
});
clientReportingRouter.post("/reports/:id/share", requireAuth, async (req, res, next) => {
    try {
        if (!["OWNER", "ADMIN", "MANAGER"].includes(req.auth.role))
            throw statusError(403, "report_share_forbidden", "An owner, admin, or manager must manage client report links.");
        const { id } = idSchema.parse(req.params);
        await loadReport(req.auth.organizationId, id);
        const input = z.object({ expiresInDays: z.number().int().min(1).max(365).default(60) }).parse(req.body ?? {});
        const share = newShareToken();
        const data = await prisma.clientReport.update({ where: { id }, data: { accessTokenHash: share.hash, accessExpiresAt: new Date(Date.now() + input.expiresInDays * 86400000), accessRevokedAt: null } });
        res.json({ data: { reportId: data.id, url: publicUrl(share.token), expiresAt: data.accessExpiresAt } });
    }
    catch (error) {
        getError(error, res, next);
    }
});
clientReportingRouter.delete("/reports/:id/share", requireAuth, async (req, res, next) => {
    try {
        if (!["OWNER", "ADMIN", "MANAGER"].includes(req.auth.role))
            throw statusError(403, "report_share_forbidden", "An owner, admin, or manager must manage client report links.");
        const { id } = idSchema.parse(req.params);
        await loadReport(req.auth.organizationId, id);
        await prisma.clientReport.update({ where: { id }, data: { accessTokenHash: null, accessExpiresAt: null, accessRevokedAt: new Date() } });
        res.status(204).end();
    }
    catch (error) {
        getError(error, res, next);
    }
});
clientReportingRouter.get("/public/:token", async (req, res, next) => {
    try {
        const token = z.string().min(32).max(100).parse(req.params.token);
        const hash = createHash("sha256").update(token).digest("hex");
        const report = await prisma.clientReport.findFirst({ where: { accessTokenHash: hash, accessRevokedAt: null, accessExpiresAt: { gt: new Date() }, status: { in: ["APPROVED", "DELIVERED", "DELIVERY_FAILED"] } }, include: { client: { select: { name: true } }, websites: { include: { domain: { select: { host: true } } } } } });
        if (!report)
            throw statusError(404, "report_link_unavailable", "This client report link is invalid, expired, or revoked.");
        const requestAddress = req.ip ?? "unknown";
        const ipHash = createHash("sha256").update(`${process.env.REPORT_ACCESS_LOG_SALT ?? "searchlight-client-report"}:${requestAddress}`).digest("hex");
        await prisma.clientReportAccessLog.create({ data: { organizationId: report.organizationId, reportId: report.id, userAgent: req.get("user-agent")?.slice(0, 500), ipHash } });
        const branding = await prisma.clientReportBranding.findUnique({ where: { organizationId: report.organizationId }, select: { agencyName: true, logoUrl: true, primaryColor: true, secondaryColor: true, contactEmail: true, websiteUrl: true, disclaimer: true, copyrightText: true } });
        const snapshot = report.dataSnapshot;
        res.json({ data: { title: report.title, period: reportPeriodLabel(report), client: report.client, websites: report.websites.map((row) => row.domain.host), snapshot: { ...snapshot, sections: Object.fromEntries(Object.entries(snapshot.sections ?? {}).filter(([, section]) => !section.hidden)) }, commentary: report.commentary, manualNotes: report.manualNotes, generatedAt: report.generatedAt, branding } });
    }
    catch (error) {
        getError(error, res, next);
    }
});
clientReportingRouter.get("/analytics", requireAuth, async (req, res, next) => {
    try {
        const organizationId = req.auth.organizationId;
        const query = z.object({ clientId: z.string().optional(), status: z.string().optional(), offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(100).default(25) }).parse(req.query);
        const where = { organizationId, ...(query.clientId ? { clientId: query.clientId } : {}), ...(query.status ? { status: query.status } : {}) };
        const [generated, awaitingReview, delivered, failedDeliveries, views, recent] = await Promise.all([prisma.clientReport.count({ where }), prisma.clientReport.count({ where: { ...where, status: "AWAITING_REVIEW" } }), prisma.clientReportDelivery.count({ where: { organizationId, report: query.clientId ? { clientId: query.clientId } : undefined, status: "ACCEPTED" } }), prisma.clientReportDelivery.count({ where: { organizationId, report: query.clientId ? { clientId: query.clientId } : undefined, status: { in: ["FAILED", "UNKNOWN"] } } }), prisma.clientReportAccessLog.count({ where: { organizationId, report: query.clientId ? { clientId: query.clientId } : undefined } }), prisma.clientReport.findMany({ where, orderBy: { generatedAt: "desc" }, skip: query.offset, take: query.limit, include: { client: { select: { name: true } }, deliveries: { orderBy: { createdAt: "desc" }, take: 1 }, accessLogs: { orderBy: { accessedAt: "desc" }, take: 1 }, _count: { select: { accessLogs: true, deliveries: true } } } })]);
        res.json({ data: { generated, awaitingReview, acceptedDeliveries: delivered, failedDeliveries, reportViews: views, recent }, pagination: { offset: query.offset, limit: query.limit } });
    }
    catch (error) {
        getError(error, res, next);
    }
});
const scheduleInputSchema = z.object({ clientId: z.string().min(1), templateId: z.string().min(1), name: z.string().trim().min(2).max(120), frequency: z.enum(clientReportFrequencies), scheduleDay: z.number().int().min(0).max(31).default(1), scheduleMonth: z.number().int().min(1).max(12).default(1), scheduleHour: z.number().int().min(0).max(23).default(9), scheduleMinute: z.number().int().min(0).max(59).default(0), timezone: z.string().trim().min(1).max(64), websiteIds: z.array(z.string().min(1)).min(1).max(20), recipients: z.array(z.object({ email: z.string().trim().email().max(254), recipientType: z.enum(["TO", "CC", "BCC"]).default("TO") }).strict()).min(1).max(30), approvalRequired: z.boolean().default(true), autoDeliveryEnabled: z.boolean().default(false), isActive: z.boolean().default(true) }).superRefine((value, ctx) => {
    if (value.frequency === "WEEKLY" && value.scheduleDay > 6)
        ctx.addIssue({ code: "custom", path: ["scheduleDay"], message: "For weekly schedules, choose a weekday from 0 (Sunday) to 6 (Saturday)." });
    if (value.frequency !== "WEEKLY" && value.scheduleDay < 1)
        ctx.addIssue({ code: "custom", path: ["scheduleDay"], message: "Choose a schedule day from 1 to 31." });
    if (value.frequency === "QUARTERLY" && ![1, 4, 7, 10].includes(value.scheduleMonth))
        ctx.addIssue({ code: "custom", path: ["scheduleMonth"], message: "Quarterly reports run from a quarter-start month: January, April, July, or October." });
    if (value.autoDeliveryEnabled && value.approvalRequired)
        ctx.addIssue({ code: "custom", path: ["autoDeliveryEnabled"], message: "Automatic delivery requires disabling the per-report approval requirement." });
    if (new Set(value.websiteIds).size !== value.websiteIds.length)
        ctx.addIssue({ code: "custom", path: ["websiteIds"], message: "Select each website once." });
    if (new Set(value.recipients.map((item) => `${item.email.toLowerCase()}:${item.recipientType}`)).size !== value.recipients.length)
        ctx.addIssue({ code: "custom", path: ["recipients"], message: "Each email and recipient type must be unique." });
});
clientReportingRouter.get("/schedules", requireAuth, async (req, res, next) => {
    try {
        const organizationId = req.auth.organizationId;
        const [data, email] = await Promise.all([
            prisma.clientReportSchedule.findMany({
                where: { organizationId },
                orderBy: [{ isActive: "desc" }, { nextRunAt: "asc" }],
                include: {
                    client: { select: { id: true, name: true } },
                    template: { select: { id: true, name: true } },
                    recipients: true,
                    websites: { include: { domain: { select: { id: true, host: true } }, project: { select: { id: true, name: true } } } },
                    _count: { select: { reports: true } },
                },
            }),
            getWorkspaceProviderCredentials(organizationId, "resend"),
        ]);
        res.json({ data, emailConfigured: Boolean(email.apiKey?.trim() && email.from?.trim()) });
    }
    catch (error) {
        getError(error, res, next);
    }
});
clientReportingRouter.post("/schedules", requireAuth, async (req, res, next) => {
    try {
        if (!["OWNER", "ADMIN", "MANAGER"].includes(req.auth.role))
            throw statusError(403, "schedule_manage_forbidden", "An owner, admin, or manager must create report schedules.");
        const input = scheduleInputSchema.parse(req.body);
        try {
            new Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
        }
        catch {
            throw statusError(400, "invalid_timezone", "Choose a valid IANA timezone.");
        }
        if (input.autoDeliveryEnabled && !["OWNER", "ADMIN"].includes(req.auth.role))
            throw statusError(403, "auto_delivery_admin_required", "Only an owner or admin can enable automatic client delivery.");
        const emailCredentials = await getWorkspaceProviderCredentials(req.auth.organizationId, "resend");
        if (input.autoDeliveryEnabled && (!emailCredentials.apiKey?.trim() || !emailCredentials.from?.trim()))
            throw statusError(409, "email_provider_unavailable", "Configure a Resend API key and verified sender in workspace Settings before enabling automatic delivery.");
        const client = await scopedClient(req.auth.organizationId, input.clientId);
        await scopedTemplate(req.auth.organizationId, input.templateId, input.clientId);
        const websites = client.websites.filter((website) => input.websiteIds.includes(website.domainId));
        if (websites.length !== input.websiteIds.length)
            throw statusError(403, "client_website_forbidden", "A selected website is not connected to this client.");
        const nextRunAt = input.isActive ? nextReportScheduleAt(new Date(), input.frequency, input.scheduleDay, input.scheduleHour, input.scheduleMinute, input.timezone, input.scheduleMonth) : null;
        const { websiteIds, recipients, ...fields } = input;
        const schedule = await prisma.clientReportSchedule.create({ data: { organizationId: req.auth.organizationId, ...fields, nextRunAt, websites: { create: websites.map((website) => ({ domainId: website.domainId, projectId: website.projectId })) }, recipients: { create: recipients.map((item) => ({ email: item.email.toLowerCase(), recipientType: item.recipientType })) } }, include: { client: { select: { id: true, name: true } }, template: { select: { id: true, name: true } }, recipients: true, websites: { include: { domain: { select: { host: true } } } } } });
        res.status(201).json({ data: schedule, note: "Schedules generate a reviewable report first. Client delivery remains off unless an owner/admin explicitly enables it and disables approval." });
    }
    catch (error) {
        getError(error, res, next);
    }
});
clientReportingRouter.patch("/schedules/:id", requireAuth, async (req, res, next) => {
    try {
        if (!["OWNER", "ADMIN", "MANAGER"].includes(req.auth.role))
            throw statusError(403, "schedule_manage_forbidden", "An owner, admin, or manager must manage report schedules.");
        const { id } = idSchema.parse(req.params);
        const input = z.object({ isActive: z.boolean().optional(), autoDeliveryEnabled: z.boolean().optional(), approvalRequired: z.boolean().optional() }).superRefine((value, ctx) => { if (value.autoDeliveryEnabled === true && value.approvalRequired === true)
            ctx.addIssue({ code: "custom", path: ["autoDeliveryEnabled"], message: "Automatic delivery requires approval to be disabled." }); }).parse(req.body);
        const current = await prisma.clientReportSchedule.findFirst({ where: { id, organizationId: req.auth.organizationId } });
        if (!current)
            throw statusError(404, "schedule_not_found", "Report schedule was not found.");
        const autoDeliveryEnabled = input.autoDeliveryEnabled ?? current.autoDeliveryEnabled;
        const approvalRequired = input.approvalRequired ?? current.approvalRequired;
        if (autoDeliveryEnabled && approvalRequired)
            throw statusError(400, "approval_required_for_auto_delivery", "Disable approval before enabling automatic delivery.");
        const emailCredentials = await getWorkspaceProviderCredentials(req.auth.organizationId, "resend");
        if (autoDeliveryEnabled && (!['OWNER', 'ADMIN'].includes(req.auth.role) || !emailCredentials.apiKey?.trim() || !emailCredentials.from?.trim()))
            throw statusError(403, "auto_delivery_admin_required", "An owner/admin and configured Resend provider are required to enable automatic delivery.");
        const isActive = input.isActive ?? current.isActive;
        const nextRunAt = isActive && (!current.isActive || !current.nextRunAt) ? nextReportScheduleAt(new Date(), current.frequency, current.scheduleDay, current.scheduleHour, current.scheduleMinute, current.timezone, current.scheduleMonth) : isActive ? current.nextRunAt : null;
        const data = await prisma.clientReportSchedule.update({ where: { id }, data: { ...input, nextRunAt } });
        res.json({ data });
    }
    catch (error) {
        getError(error, res, next);
    }
});
clientReportingRouter.delete("/schedules/:id", requireAuth, async (req, res, next) => {
    try {
        if (!["OWNER", "ADMIN", "MANAGER"].includes(req.auth.role))
            throw statusError(403, "schedule_manage_forbidden", "An owner, admin, or manager must delete report schedules.");
        const { id } = idSchema.parse(req.params);
        const removed = await prisma.clientReportSchedule.deleteMany({ where: { id, organizationId: req.auth.organizationId } });
        if (!removed.count)
            throw statusError(404, "schedule_not_found", "Report schedule was not found.");
        res.status(204).end();
    }
    catch (error) {
        getError(error, res, next);
    }
});
export async function runDueClientReportSchedules(now = new Date()) {
    const due = await prisma.clientReportSchedule.findMany({ where: { isActive: true, nextRunAt: { lte: now } }, orderBy: { nextRunAt: "asc" }, take: 10, include: { client: { include: { websites: { include: { domain: { select: { id: true, host: true } } } } } }, template: { include: { sections: { orderBy: { position: "asc" } } } }, websites: { include: { domain: { select: { id: true, host: true } } } }, recipients: true } });
    for (const schedule of due) {
        let nextAt;
        try {
            nextAt = nextReportScheduleAt(now, schedule.frequency, schedule.scheduleDay, schedule.scheduleHour, schedule.scheduleMinute, schedule.timezone, schedule.scheduleMonth);
        }
        catch (error) {
            await prisma.clientReportSchedule.update({ where: { id: schedule.id }, data: { isActive: false, lastError: error instanceof Error ? error.message : "Invalid schedule configuration." } });
            continue;
        }
        const claimed = await prisma.clientReportSchedule.updateMany({ where: { id: schedule.id, isActive: true, nextRunAt: { lte: now } }, data: { nextRunAt: nextAt, lastRunAt: now } });
        if (!claimed.count)
            continue;
        const period = previousCompletedPeriod(now, schedule.frequency, schedule.timezone);
        const comparison = previousCompletedPeriod(new Date(period.start.getTime() - 1), schedule.frequency, schedule.timezone);
        try {
            const result = await buildAndSaveReport({ organizationId: schedule.organizationId, userId: null, clientId: schedule.clientId, templateId: schedule.templateId, websiteIds: schedule.websites.map((website) => website.domainId), start: period.start, end: period.end, comparisonStart: comparison.start, comparisonEnd: comparison.end, timezone: schedule.timezone, scheduleId: schedule.id, scheduleSlot: schedule.lastRunAt?.toISOString() ?? now.toISOString() });
            await prisma.clientReportSchedule.update({ where: { id: schedule.id }, data: { failureCount: 0, lastError: null } });
            if (schedule.autoDeliveryEnabled && !schedule.approvalRequired) {
                await prisma.clientReport.update({ where: { id: result.report.id }, data: { status: "APPROVED", approvedAt: now } });
                await prisma.clientReportApproval.create({ data: { reportId: result.report.id, status: "AUTO_APPROVED_BY_SCHEDULE_POLICY", reviewedById: "system:schedule-policy", comments: "Owner/admin explicitly enabled auto delivery with report approval disabled." } });
                await deliverReport(schedule.organizationId, result.report.id, schedule.recipients.filter((x) => x.recipientType === "TO").map((x) => x.email), schedule.lastRunAt?.toISOString() ?? now.toISOString(), null);
            }
        }
        catch (error) {
            const failureCount = schedule.failureCount + 1;
            const retryAt = failureCount < 3 ? new Date(now.getTime() + 10 * 60_000) : nextAt;
            await prisma.clientReportSchedule.update({ where: { id: schedule.id }, data: { failureCount, lastError: (error instanceof Error ? error.message : "Scheduled report failed.").slice(0, 1200), nextRunAt: retryAt } });
            await prisma.activityLog.create({ data: { organizationId: schedule.organizationId, action: "client_report.schedule_failed", entityType: "ClientReportSchedule", entityId: schedule.id, metadata: { failureCount, message: error instanceof Error ? error.message.slice(0, 800) : "unknown failure", retryAt } } });
        }
    }
}
