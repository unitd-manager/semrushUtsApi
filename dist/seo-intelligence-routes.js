import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db.js";
import { requireAuth } from "./auth.js";
import { analyzeContentPageSignals, classifyPageChangeRisk, compareCompetitorKeywordSnapshots, comparePageSnapshots, suggestContextualLink } from "./seo-intelligence.js";
export const seoIntelligenceRouter = Router();
const managerRoles = ["OWNER", "ADMIN", "MANAGER"];
const recordTypes = ["KEYWORD_MAPPING", "CANNIBALIZATION", "INTERNAL_LINK", "CONTENT_OPTIMIZATION", "COMPETITOR_CHANGE", "CALENDAR_ACTIVITY", "WEBSITE_CHANGE"];
const statuses = ["OPEN", "APPROVED", "REJECTED", "COMPLETED", "VERIFIED"];
function fail(statusCode, code, message) { return Object.assign(new Error(message), { statusCode, code }); }
function handle(error, res, next) {
    if (error instanceof z.ZodError) {
        res.status(400).json({ error: { code: "validation_error", message: "Check the submitted fields.", fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) } });
        return;
    }
    if (error && typeof error === "object" && "statusCode" in error) {
        const item = error;
        res.status(item.statusCode).json({ error: { code: item.code ?? "seo_intelligence_request_failed", message: item.message ?? "The SEO intelligence request could not be completed." } });
        return;
    }
    next(error);
}
const wrap = (fn) => (req, res, next) => { void fn(req, res).catch((error) => handle(error, res, next)); };
seoIntelligenceRouter.use(requireAuth);
async function validateScope(organizationId, projectId, websiteId) {
    const project = projectId ? await prisma.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true } }) : null;
    if (projectId && !project)
        throw fail(404, "project_not_found", "Project was not found in this workspace.");
    const website = websiteId ? await prisma.domain.findFirst({ where: { id: websiteId, organizationId, ...(projectId ? { projectId } : {}) }, select: { id: true, projectId: true } }) : null;
    if (websiteId && !website)
        throw fail(404, "website_not_found", "Website was not found in this workspace project.");
    return { projectId: projectId ?? website?.projectId ?? null, websiteId: website?.id ?? null };
}
function jsonValue(value) {
    if (value == null)
        return {};
    const encoded = JSON.stringify(value);
    if (encoded.length > 50_000)
        throw fail(400, "record_too_large", "Keep SEO evidence under 50 KB per record.");
    return JSON.parse(encoded);
}
async function recordActivity(organizationId, userId, action, recordId, metadata) {
    await prisma.activityLog.create({ data: { organizationId, userId, action, entityType: "SeoIntelligenceRecord", entityId: recordId, metadata: metadata } });
}
seoIntelligenceRouter.get("/records", wrap(async (req, res) => {
    const query = z.object({ type: z.enum(recordTypes).optional(), status: z.enum(statuses).optional(), projectId: z.string().optional(), websiteId: z.string().optional(), q: z.string().trim().max(120).optional(), offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
    const organizationId = req.auth.organizationId;
    const scope = await validateScope(organizationId, query.projectId, query.websiteId);
    const where = { organizationId, ...(query.type ? { type: query.type } : {}), ...(query.status ? { status: query.status } : {}), ...(query.projectId ? { projectId: query.projectId } : {}), ...(query.websiteId ? { websiteId: query.websiteId } : {}), ...(query.q ? { title: { contains: query.q } } : {}) };
    const [total, data] = await Promise.all([prisma.seoIntelligenceRecord.count({ where }), prisma.seoIntelligenceRecord.findMany({ where, orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }], skip: query.offset, take: query.limit })]);
    res.json({ data, pagination: { total, offset: query.offset, limit: query.limit, hasMore: query.offset + data.length < total }, scope });
}));
seoIntelligenceRouter.post("/records", wrap(async (req, res) => {
    if (![...managerRoles, "ANALYST"].includes(req.auth.role))
        throw fail(403, "record_write_forbidden", "Your role cannot create SEO intelligence records.");
    const input = z.object({ type: z.enum(recordTypes), title: z.string().trim().min(2).max(240), projectId: z.string().min(1).nullable().optional(), websiteId: z.string().min(1).nullable().optional(), priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"), sourceModule: z.string().trim().max(80).nullable().optional(), sourceId: z.string().trim().max(191).nullable().optional(), data: z.unknown().default({}), evidence: z.unknown().nullable().optional(), dedupeKey: z.string().trim().max(191).nullable().optional() }).strict().parse(req.body);
    const organizationId = req.auth.organizationId;
    const scope = await validateScope(organizationId, input.projectId, input.websiteId);
    const payload = input.data && typeof input.data === "object" && !Array.isArray(input.data) ? input.data : {};
    if (input.type === "KEYWORD_MAPPING") {
        const phrase = typeof payload.keyword === "string" ? payload.keyword.trim() : "";
        const targetUrl = typeof payload.url === "string" ? payload.url : typeof payload.suggestedUrl === "string" ? payload.suggestedUrl : "";
        let parsed;
        try {
            parsed = new URL(targetUrl);
        }
        catch {
            throw fail(400, "mapping_url_invalid", "A mapping requires a valid HTTPS target URL.");
        }
        const website = scope.websiteId ? await prisma.domain.findFirst({ where: { id: scope.websiteId, organizationId }, select: { host: true } }) : await prisma.domain.findFirst({ where: { organizationId, projectId: scope.projectId, isPrimary: true }, select: { host: true } });
        if (phrase.length < 2 || phrase.length > 200 || parsed.protocol !== "https:" || !website || parsed.hostname.toLowerCase() !== website.host.toLowerCase())
            throw fail(400, "mapping_scope_invalid", "A mapping requires a keyword and an HTTPS URL on the selected project website.");
    }
    if (input.type === "CALENDAR_ACTIVITY" && typeof payload.scheduledAt === "string" && (!Number.isFinite(Date.parse(payload.scheduledAt)) || Date.parse(payload.scheduledAt) < Date.now()))
        throw fail(400, "calendar_time_invalid", "Choose a valid planned time in the future.");
    const dedupeKey = input.dedupeKey ?? (input.type === "KEYWORD_MAPPING" ? `KEYWORD_MAPPING:${scope.projectId}:${String(payload.keyword).trim().toLocaleLowerCase()}:${String(payload.url ?? payload.suggestedUrl).trim()}` : null);
    if (dedupeKey) {
        const existing = await prisma.seoIntelligenceRecord.findUnique({ where: { dedupeKey } });
        if (existing) {
            if (existing.organizationId !== organizationId)
                throw fail(409, "record_dedupe_conflict", "A record with this source key already exists outside the active workspace.");
            res.json({ data: existing, deduplicated: true });
            return;
        }
    }
    const saved = await prisma.seoIntelligenceRecord.create({ data: { organizationId, ...scope, type: input.type, title: input.title, priority: input.priority, sourceModule: input.sourceModule ?? null, sourceId: input.sourceId ?? null, data: jsonValue(input.data), evidence: input.evidence == null ? Prisma.JsonNull : jsonValue(input.evidence), dedupeKey, createdById: req.auth.userId } });
    await recordActivity(organizationId, req.auth.userId, "seo_intelligence.record_created", saved.id, { type: saved.type });
    res.status(201).json({ data: saved });
}));
seoIntelligenceRouter.patch("/records/:id", wrap(async (req, res) => {
    const id = z.string().min(1).max(191).parse(req.params.id);
    const organizationId = req.auth.organizationId;
    const existing = await prisma.seoIntelligenceRecord.findFirst({ where: { id, organizationId } });
    if (!existing)
        throw fail(404, "record_not_found", "SEO intelligence record was not found in this workspace.");
    const input = z.object({ status: z.enum(statuses).optional(), title: z.string().trim().min(2).max(240).optional(), priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).optional(), data: z.unknown().optional(), reviewNote: z.string().trim().max(2000).optional() }).strict().parse(req.body);
    if (input.status && !["APPROVED", "REJECTED"].includes(input.status))
        throw fail(400, "invalid_record_transition", "Use the task verification workflow to record completion; recommendation status may only be approved or rejected here.");
    const decision = input.status === "APPROVED" || input.status === "REJECTED";
    if ((input.status !== undefined || input.data !== undefined || input.priority !== undefined) && !managerRoles.includes(req.auth.role))
        throw fail(403, "record_review_forbidden", "A workspace manager must approve or edit SEO recommendations.");
    const updated = await prisma.seoIntelligenceRecord.update({ where: { id }, data: { ...(input.status ? { status: input.status } : {}), ...(input.title ? { title: input.title } : {}), ...(input.priority ? { priority: input.priority } : {}), ...(input.data !== undefined ? { data: jsonValue(input.data) } : {}), ...(decision ? { reviewedById: req.auth.userId, reviewedAt: new Date(), evidence: jsonValue({ ...(existing.evidence ?? {}), reviewNote: input.reviewNote ?? null, decision: input.status }) } : {}) } });
    await recordActivity(organizationId, req.auth.userId, decision ? `seo_intelligence.${input.status.toLowerCase()}` : "seo_intelligence.record_updated", id, { type: existing.type, previousStatus: existing.status, newStatus: updated.status, reviewNote: input.reviewNote });
    res.json({ data: updated });
}));
seoIntelligenceRouter.post("/records/:id/task", wrap(async (req, res) => {
    if (![...managerRoles, "ANALYST"].includes(req.auth.role))
        throw fail(403, "seo_task_forbidden", "Your role cannot create SEO Operations tasks.");
    const id = z.string().min(1).max(191).parse(req.params.id);
    const organizationId = req.auth.organizationId;
    const record = await prisma.seoIntelligenceRecord.findFirst({ where: { id, organizationId } });
    if (!record)
        throw fail(404, "record_not_found", "SEO intelligence record was not found in this workspace.");
    if (record.status !== "APPROVED")
        throw fail(409, "record_not_approved", "Approve the recommendation before creating its SEO Operations task.");
    const input = z.object({ seoProjectId: z.string().min(1).nullable().optional(), assigneeId: z.string().min(1).nullable().optional(), dueDate: z.string().date().nullable().optional() }).strict().parse(req.body);
    if (input.assigneeId && !await prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId, userId: input.assigneeId } }, select: { userId: true } }))
        throw fail(400, "team_member_not_found", "Choose an active member of this workspace.");
    if (input.seoProjectId && !await prisma.seoOpsProject.findFirst({ where: { id: input.seoProjectId, organizationId, ...(record.projectId ? { projectId: record.projectId } : {}) }, select: { id: true } }))
        throw fail(404, "seo_project_not_found", "SEO Operations project was not found in this workspace scope.");
    const details = record.data;
    const taskDedupeKey = `seo-intelligence:${record.id}`;
    const alreadyCreated = await prisma.seoTask.findUnique({ where: { dedupeKey: taskDedupeKey } });
    if (alreadyCreated) {
        if (alreadyCreated.organizationId !== organizationId)
            throw fail(409, "task_dedupe_conflict", "A task with this source key already exists outside the active workspace.");
        res.json({ data: alreadyCreated, deduplicated: true });
        return;
    }
    const affectedUrls = [details.url, details.sourceUrl, details.destinationUrl, details.suggestedUrl].filter((value) => typeof value === "string" && /^https:\/\//iu.test(value));
    const targetKeywords = typeof details.keyword === "string" ? [details.keyword] : [];
    const task = await prisma.$transaction(async (tx) => {
        const created = await tx.seoTask.create({ data: { organizationId, seoProjectId: input.seoProjectId ?? null, projectId: record.projectId, websiteId: record.websiteId, title: record.title.slice(0, 200), description: `Approved ${record.type.toLocaleLowerCase().replaceAll("_", " ")} recommendation. Review the attached source evidence before implementation.`, category: record.type === "CONTENT_OPTIMIZATION" ? "CONTENT_OPTIMIZATION" : record.type === "INTERNAL_LINK" ? "INTERNAL_LINKING" : record.type.includes("KEYWORD") || record.type === "CANNIBALIZATION" ? "SEO_STRATEGY" : "TECHNICAL_SEO", priority: record.priority === "CRITICAL" ? "P0" : record.priority === "HIGH" ? "P1" : record.priority === "LOW" ? "P3" : "P2", severity: record.priority === "CRITICAL" ? "CRITICAL" : record.priority === "HIGH" ? "HIGH" : "MEDIUM", status: input.assigneeId ? "ASSIGNED" : "TODO", assigneeId: input.assigneeId ?? null, dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00.000Z`) : null, sourceModule: "SEO_INTELLIGENCE", sourceEntityType: record.type, sourceEntityId: record.id, sourceEvidence: jsonValue({ data: record.data, evidence: record.evidence }), affectedUrls: jsonValue(affectedUrls), targetKeywords: jsonValue(targetKeywords), labels: jsonValue([record.type.toLocaleLowerCase()]), acceptanceCriteria: jsonValue(["Implement only the approved change.", "Verify the original source condition after implementation."]), createdById: req.auth.userId, dedupeKey: taskDedupeKey } });
        await tx.seoTaskActivity.create({ data: { taskId: created.id, actorId: req.auth.userId, action: "TASK_CREATED_FROM_SEO_INTELLIGENCE", metadata: { recordId: record.id, recordType: record.type } } });
        await tx.activityLog.create({ data: { organizationId, userId: req.auth.userId, action: "seo_intelligence.task_created", entityType: "SeoIntelligenceRecord", entityId: record.id, metadata: { taskId: created.id } } });
        return created;
    });
    res.status(201).json({ data: task });
}));
// Analyses consume only stored workspace observations. Generated records remain candidates for human review.
seoIntelligenceRouter.post("/analyze", wrap(async (req, res) => {
    if (![...managerRoles, "ANALYST"].includes(req.auth.role))
        throw fail(403, "analysis_forbidden", "Your role cannot run SEO intelligence analyses that create review records.");
    const input = z.object({ type: z.enum(["KEYWORD_MAPPING", "CANNIBALIZATION", "INTERNAL_LINK", "CONTENT_OPTIMIZATION", "COMPETITOR_CHANGE", "WEBSITE_CHANGE"]), projectId: z.string().min(1), websiteId: z.string().min(1).optional(), competitorId: z.string().min(1).optional(), url: z.string().url().max(2048).optional() }).strict().parse(req.body);
    const organizationId = req.auth.organizationId;
    const scope = await validateScope(organizationId, input.projectId, input.websiteId);
    const domain = scope.websiteId ? await prisma.domain.findFirst({ where: { id: scope.websiteId, organizationId, projectId: input.projectId } }) : await prisma.domain.findFirst({ where: { organizationId, projectId: input.projectId, isPrimary: true } });
    if (!domain)
        throw fail(409, "primary_domain_required", "Add a website to this project before analyzing SEO evidence.");
    const findings = [];
    if (input.type === "KEYWORD_MAPPING" || input.type === "CANNIBALIZATION") {
        const rows = await prisma.ranking.findMany({ where: { domainId: domain.id, url: { not: null } }, orderBy: { observedAt: "desc" }, take: 5000 });
        const latest = new Map();
        for (const row of rows) {
            const key = `${row.keyword.toLocaleLowerCase()}|${row.location}|${row.device}`;
            if (!latest.has(key))
                latest.set(key, row);
        }
        const groups = new Map();
        for (const row of latest.values()) {
            const key = row.keyword.toLocaleLowerCase();
            groups.set(key, [...(groups.get(key) ?? []), row]);
        }
        for (const [keyword, observations] of groups) {
            const urls = [...new Map(observations.filter((row) => row.url).map((row) => [row.url, row])).values()];
            if (input.type === "CANNIBALIZATION" && urls.length < 2)
                continue;
            if (input.type === "KEYWORD_MAPPING" && urls.length !== 1)
                continue;
            const preferred = [...urls].sort((a, b) => (a.position ?? 101) - (b.position ?? 101))[0];
            const key = `${input.type}:${domain.id}:${keyword}`;
            findings.push({ type: input.type, title: input.type === "KEYWORD_MAPPING" ? `Review ranking URL for "${preferred.keyword}"` : `Review competing URLs for "${preferred.keyword}"`, priority: urls.length > 2 ? "HIGH" : "MEDIUM", sourceModule: "RANK_TRACKING", sourceId: preferred.id, dedupeKey: key, data: { keyword: preferred.keyword, suggestedUrl: preferred.url, competingUrls: urls.map((row) => ({ url: row.url, position: row.position, location: row.location, device: row.device, observedAt: row.observedAt, provider: row.provider, confidence: row.confidence })), decision: "CANDIDATE_REQUIRES_REVIEW", limitation: "Multiple observed ranking URLs indicate overlap to investigate, not proof of cannibalization." }, evidence: { observationCount: urls.length, latestObservedAt: preferred.observedAt, source: "stored Ranking observations" } });
        }
    }
    if (input.type === "INTERNAL_LINK") {
        const crawl = await prisma.crawl.findFirst({ where: { domainId: domain.id, status: "completed" }, orderBy: { finishedAt: "desc" }, include: { pages: { include: { outgoing: { where: { internal: true } }, incoming: { where: { internal: true } } } } } });
        if (!crawl)
            throw fail(409, "crawl_required", "Run Site Audit before generating internal link candidates.");
        const pages = crawl.pages.filter((page) => page.indexable !== false && page.statusCode != null && page.statusCode < 400);
        for (const target of pages.filter((page) => page.incoming.length === 0)) {
            const source = pages.filter((page) => page.id !== target.id).map((page) => ({ page, suggestion: suggestContextualLink({ title: page.title, h1: page.h1, url: page.url }, { title: target.title, h1: target.h1, url: target.url }, page.outgoing.some((link) => link.targetUrl === target.url)) })).filter((item) => item.suggestion).sort((a, b) => b.suggestion.relevanceTerms.length - a.suggestion.relevanceTerms.length)[0];
            if (!source?.suggestion)
                continue;
            findings.push({ type: "INTERNAL_LINK", title: `Review a contextual link to ${target.url}`, priority: "MEDIUM", sourceModule: "SITE_AUDIT", sourceId: crawl.id, dedupeKey: `INTERNAL_LINK:${crawl.id}:${source.page.id}:${target.id}`, data: { sourceUrl: source.page.url, destinationUrl: target.url, suggestedAnchor: source.suggestion.suggestedAnchor, placementHint: "Review the source page manually and place the link in a relevant paragraph.", relevanceTerms: source.suggestion.relevanceTerms, execution: "REVIEW_ONLY_NO_CMS_WRITE" }, evidence: { crawlId: crawl.id, crawlFinishedAt: crawl.finishedAt, sourceTitle: source.page.title, destinationTitle: target.title, sourceInternalLinks: source.page.outgoing.length, destinationInboundLinksInCrawl: target.incoming.length, coverage: "only pages present in this bounded crawl" } });
        }
    }
    if (input.type === "WEBSITE_CHANGE") {
        const crawls = await prisma.crawl.findMany({ where: { domainId: domain.id, status: "completed" }, orderBy: { finishedAt: "desc" }, take: 2, include: { pages: true } });
        if (crawls.length < 2)
            throw fail(409, "baseline_required", "Run at least two completed crawls to compare stored website observations.");
        const current = new Map(crawls[0].pages.map((page) => [page.url, page]));
        for (const prior of crawls[1].pages) {
            const now = current.get(prior.url);
            if (!now)
                continue;
            const changes = comparePageSnapshots(prior, now);
            if (!changes.length)
                continue;
            const risk = classifyPageChangeRisk(changes);
            findings.push({ type: "WEBSITE_CHANGE", title: `Observed ${changes.map((change) => change.field).join(", ")} change on ${prior.url}`, priority: risk, sourceModule: "SITE_AUDIT", sourceId: crawls[0].id, dedupeKey: `WEBSITE_CHANGE:${crawls[0].id}:${prior.url}`, data: { url: prior.url, changes, risk, causality: "not_established" }, evidence: { beforeCrawlId: crawls[1].id, afterCrawlId: crawls[0].id, beforeCrawledAt: prior.crawledAt, afterCrawledAt: now.crawledAt, comparedFields: ["statusCode", "title", "description", "h1", "canonical", "robots", "indexable", ...(prior.h1Count != null && now.h1Count != null ? ["h1Count"] : []), ...(prior.contentDigest && now.contentDigest ? ["contentDigest"] : [])] } });
        }
        const previousUrls = new Set(crawls[1].pages.map((page) => page.url));
        const currentUrls = new Set(crawls[0].pages.map((page) => page.url));
        for (const page of crawls[0].pages.filter((item) => !previousUrls.has(item.url)))
            findings.push({ type: "WEBSITE_CHANGE", title: `Newly observed URL ${page.url}`, priority: "LOW", sourceModule: "SITE_AUDIT", sourceId: crawls[0].id, dedupeKey: `WEBSITE_CHANGE:${crawls[0].id}:${page.url}`, data: { url: page.url, change: "URL_NOT_IN_PREVIOUS_CRAWL", causality: "not_established" }, evidence: { beforeCrawlId: crawls[1].id, afterCrawlId: crawls[0].id, detectedAt: page.crawledAt, coverage: "bounded crawls; newly observed does not prove publication" } });
        for (const page of crawls[1].pages.filter((item) => !currentUrls.has(item.url)))
            findings.push({ type: "WEBSITE_CHANGE", title: `Previously observed URL missing from latest crawl: ${page.url}`, priority: "HIGH", sourceModule: "SITE_AUDIT", sourceId: crawls[0].id, dedupeKey: `WEBSITE_CHANGE:${crawls[0].id}:${page.url}`, data: { url: page.url, change: "URL_NOT_OBSERVED_IN_LATEST_CRAWL", causality: "not_established" }, evidence: { beforeCrawlId: crawls[1].id, afterCrawlId: crawls[0].id, previousCrawledAt: page.crawledAt, coverage: "bounded crawl; absence may be caused by crawl coverage and requires manual verification" } });
    }
    if (input.type === "CONTENT_OPTIMIZATION") {
        let targetUrl;
        if (input.url) {
            const parsed = new URL(input.url);
            if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443") || parsed.hostname.toLowerCase() !== domain.host.toLowerCase())
                throw fail(400, "content_url_scope_invalid", "Choose an HTTPS page on the selected project website.");
            parsed.hash = "";
            parsed.search = "";
            targetUrl = parsed.toString();
        }
        const crawl = await prisma.crawl.findFirst({ where: { domainId: domain.id, status: "completed" }, orderBy: { finishedAt: "desc" }, include: { pages: { where: targetUrl ? { url: targetUrl } : undefined, take: 200 } } });
        if (!crawl)
            throw fail(409, "crawl_required", "Run Site Audit before reviewing page content evidence.");
        for (const page of crawl.pages) {
            const gaps = [{ field: "title", value: page.title }, { field: "description", value: page.description }, { field: "h1", value: page.h1 }].filter((field) => !field.value);
            const qualitySignals = analyzeContentPageSignals(page);
            if (!gaps.length && !qualitySignals.length)
                continue;
            findings.push({ type: "CONTENT_OPTIMIZATION", title: `Review content opportunities for ${page.url}`, priority: "MEDIUM", sourceModule: "SITE_AUDIT", sourceId: page.id, dedupeKey: `CONTENT_OPTIMIZATION:${crawl.id}:${page.url}`, data: { url: page.url, gaps: gaps.map((gap) => gap.field), qualitySignals, workflow: "Review page intent and evidence in the Content workspace before editing." }, evidence: { crawlId: crawl.id, crawledAt: page.crawledAt, fieldsObserved: { title: page.title, titleLength: page.titleLength, description: page.description, h1: page.h1, h1Count: page.h1Count, wordCount: page.wordCount } } });
        }
    }
    if (input.type === "COMPETITOR_CHANGE") {
        if (!input.competitorId)
            throw fail(400, "competitor_required", "Choose a saved competitor to compare provider observations.");
        const competitor = await prisma.competitor.findFirst({ where: { id: input.competitorId, domainId: domain.id }, include: { snapshots: { where: { kind: "DISCOVERY" }, orderBy: { observedAt: "desc" }, take: 2 } } });
        if (!competitor)
            throw fail(404, "competitor_not_found", "Select a saved competitor for this project's primary website.");
        const gapSnapshots = await prisma.competitorSnapshot.findMany({ where: { competitorId: competitor.id, kind: "KEYWORD_GAP" }, orderBy: { observedAt: "desc" }, take: 100 });
        const newer = competitor.snapshots[0];
        const older = competitor.snapshots[1];
        const gapByScope = new Map();
        for (const snapshot of gapSnapshots)
            gapByScope.set(`${snapshot.location}:${snapshot.provider}`, [...(gapByScope.get(`${snapshot.location}:${snapshot.provider}`) ?? []), snapshot]);
        const completeGapPair = [...gapByScope.values()].map((snapshots) => snapshots.filter((snapshot) => {
            const metrics = snapshot.metrics && typeof snapshot.metrics === "object" ? snapshot.metrics : {};
            return metrics.offset === 0 && typeof metrics.requestedLimit === "number" && typeof snapshot.totalCount === "number" && metrics.requestedLimit >= snapshot.totalCount && metrics.returned === snapshot.totalCount;
        }).slice(0, 2)).find((pair) => pair.length === 2);
        if (newer && older)
            findings.push({ type: "COMPETITOR_CHANGE", title: `Review updated provider estimates for ${competitor.host}`, priority: "LOW", sourceModule: "COMPETITOR_RESEARCH", sourceId: competitor.id, dedupeKey: `COMPETITOR_CHANGE:${newer.id}`, data: { competitorHost: competitor.host, previousMetrics: older.metrics, currentMetrics: newer.metrics, comparison: "provider_estimate_change", pageContentChanges: "unavailable" }, evidence: { previousSnapshotId: older.id, previousObservedAt: older.observedAt, currentSnapshotId: newer.id, currentObservedAt: newer.observedAt, provider: newer.provider, confidence: newer.confidence } });
        if (completeGapPair) {
            const [current, previous] = completeGapPair;
            const deltas = compareCompetitorKeywordSnapshots(previous.keywords, current.keywords);
            if (deltas.added.length || deltas.removed.length)
                findings.push({ type: "COMPETITOR_CHANGE", title: `Review ${deltas.added.length} new and ${deltas.removed.length} changed competitor keyword opportunities`, priority: deltas.added.length + deltas.removed.length >= 10 ? "HIGH" : "MEDIUM", sourceModule: "COMPETITOR_KEYWORD_GAP", sourceId: competitor.id, dedupeKey: `COMPETITOR_KEYWORD_GAP:${current.id}`, data: { competitorHost: competitor.host, location: current.location, addedKeywords: deltas.added, removedKeywords: deltas.removed, comparison: "complete_saved_provider_keyword_gap_snapshots", backlinkDeltas: "unavailable_without_saved_competitor_backlink_snapshots" }, evidence: { previousSnapshotId: previous.id, previousObservedAt: previous.observedAt, currentSnapshotId: current.id, currentObservedAt: current.observedAt, provider: current.provider, confidence: current.confidence, totalKeywordsCompared: Math.min(previous.totalCount ?? 0, current.totalCount ?? 0), coverage: "only complete first-page snapshots with matching location and provider are compared" } });
        }
        if (!newer && !completeGapPair)
            throw fail(409, "snapshot_history_required", "Two saved discovery observations or two complete keyword-gap snapshots for the same provider and location are needed.");
    }
    if (!findings.length) {
        res.json({ data: [], note: "No candidate records were found from the stored observations in this scope." });
        return;
    }
    const created = await prisma.$transaction(async (tx) => {
        const saved = [];
        for (const item of findings) {
            const existing = await tx.seoIntelligenceRecord.findUnique({ where: { dedupeKey: item.dedupeKey } });
            if (existing) {
                if (existing.organizationId === organizationId)
                    saved.push({ ...existing, deduplicated: true });
                continue;
            }
            const record = await tx.seoIntelligenceRecord.create({ data: { organizationId, ...scope, type: item.type, title: item.title, status: "OPEN", priority: item.priority, sourceModule: item.sourceModule, sourceId: item.sourceId ?? null, dedupeKey: item.dedupeKey, data: jsonValue(item.data), evidence: jsonValue(item.evidence), createdById: req.auth.userId } });
            await tx.activityLog.create({ data: { organizationId, userId: req.auth.userId, action: `seo_intelligence.${item.type.toLowerCase()}_candidate_detected`, entityType: "SeoIntelligenceRecord", entityId: record.id, metadata: { sourceModule: item.sourceModule, sourceId: item.sourceId ?? null } } });
            saved.push({ ...record, deduplicated: false });
        }
        return saved;
    });
    const investigations = [];
    if (input.type === "WEBSITE_CHANGE" && input.projectId) {
        const highRisk = created.filter((record) => !record.deduplicated && record.type === "WEBSITE_CHANGE" && ["HIGH", "CRITICAL"].includes(record.priority));
        const setting = await prisma.agentSetting.findUnique({ where: { organizationId_agentId: { organizationId, agentId: "seo-root-cause-investigator" } }, select: { enabled: true } });
        if (highRisk.length && setting?.enabled !== false) {
            const urls = [...new Set(highRisk.map((record) => record.data?.url).filter((url) => typeof url === "string" && url.startsWith("https://")))].slice(0, 50);
            const task = await prisma.agentTask.create({ data: { organizationId, projectId: input.projectId, createdById: req.auth.userId, agentId: "seo-root-cause-investigator", title: `Investigate ${highRisk.length} high-risk website change${highRisk.length === 1 ? "" : "s"}`, description: "Review the saved before-and-after crawl evidence and correlate it with available ranking and audit history. This is an investigation only; it does not change the website.", scope: { investigationScope: "all_signals", domainId: domain.id, assumptions: { source: "website_change_monitor", findingIds: highRisk.map((record) => record.id), affectedUrls: urls, causality: "not_established" } }, status: "QUEUED", progress: 0, logs: [{ at: new Date().toISOString(), level: "info", message: "Queued from a high-risk website-change comparison; investigation is read-only." }] } });
            investigations.push(...highRisk.map((record) => ({ findingId: record.id, agentTaskId: task.id })));
            await prisma.activityLog.create({ data: { organizationId, userId: req.auth.userId, action: "website_change.root_cause_investigation_queued", entityType: "AgentTask", entityId: task.id, metadata: { findingIds: highRisk.map((record) => record.id), affectedUrlCount: urls.length } } });
        }
    }
    res.status(201).json({ data: created, investigations, note: "Candidates use saved workspace evidence and require human review. A read-only root-cause investigation is queued for new high-risk website changes when the agent is enabled; no production change is executed." });
}));
