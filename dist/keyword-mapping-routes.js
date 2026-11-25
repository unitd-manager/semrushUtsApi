import { createHash } from "node:crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db.js";
import { requireAuth } from "./auth.js";
import { encryptedTokenRecord } from "./google-integrations.js";
import { getGoogleReport, googleConfig, GoogleIntegrationFailure, readEncryptedTokens } from "./google-integrations.js";
import { classifySearchIntent } from "./seo-intelligence.js";
import { getWorkspaceProviderCredentials } from "./workspace-integrations.js";
/** Tenant-scoped keyword-to-page mapping API. Mount at /api/seo/keyword-mappings. */
export const keywordMappingRouter = Router();
const writers = ["OWNER", "ADMIN", "MANAGER", "ANALYST"];
const approvers = ["OWNER", "ADMIN", "MANAGER"];
const intents = ["INFORMATIONAL", "COMMERCIAL", "TRANSACTIONAL", "NAVIGATIONAL", "LOCAL", "MIXED"];
const roles = ["PRIMARY", "SECONDARY", "SUPPORTING"];
const statuses = ["PENDING_REVIEW", "APPROVED", "REJECTED"];
const fail = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });
function handle(error, res, next) {
    if (error instanceof z.ZodError) {
        res.status(400).json({ error: { code: "validation_error", message: "Check the submitted fields.", fields: error.issues.map((x) => ({ path: x.path.join("."), message: x.message })) } });
        return;
    }
    if (error && typeof error === "object" && "statusCode" in error) {
        const e = error;
        res.status(e.statusCode).json({ error: { code: e.code ?? "keyword_mapping_error", message: e.message ?? "The request could not be completed." } });
        return;
    }
    next(error);
}
const wrap = (fn) => (req, res, next) => { void fn(req, res).catch((e) => handle(e, res, next)); };
function canWrite(req) { if (!writers.includes(req.auth.role))
    throw fail(403, "forbidden", "Your role cannot change keyword mappings."); }
function canApprove(req) { if (!approvers.includes(req.auth.role))
    throw fail(403, "forbidden", "Only workspace managers can approve or reopen mappings."); }
export function canonicalPageUrl(value, host) {
    let u;
    try {
        u = new URL(value);
    }
    catch {
        throw fail(400, "invalid_page_url", "Enter a valid HTTPS page URL on this website.");
    }
    const normalizedHost = host.toLowerCase().replace(/^www\./u, "").split(":")[0];
    if (u.protocol !== "https:" || u.username || u.password || u.hostname.toLowerCase().replace(/^www\./u, "") !== normalizedHost || (u.port && u.port !== "443"))
        throw fail(400, "invalid_page_url", "Page URLs must use HTTPS and match the selected website host.");
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./u, "");
    if (u.pathname.length > 1)
        u.pathname = u.pathname.replace(/\/+$/u, "");
    const url = u.toString();
    return { url, key: createHash("sha256").update(url).digest("hex") };
}
const inputSchema = z.object({ projectId: z.string().min(1), websiteId: z.string().min(1), keywordId: z.string().min(1).nullable().optional(), keywordGroupId: z.string().min(1).nullable().optional(), phrase: z.string().trim().min(1).max(200), pageUrl: z.string().min(1).max(2048), role: z.enum(roles).default("PRIMARY"), searchIntent: z.enum(intents).nullable().optional(), confidence: z.number().min(0).max(1).nullable().optional(), decisionNote: z.string().max(4000).nullable().optional() }).strict();
const pageQuery = z.object({ projectId: z.string().optional(), websiteId: z.string().optional(), keywordId: z.string().optional(), q: z.string().trim().max(200).optional(), status: z.enum(statuses).optional(), role: z.enum(roles).optional(), offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(100).default(50) });
keywordMappingRouter.use(requireAuth);
keywordMappingRouter.use((req, res, next) => {
    if (!writers.includes(req.auth?.role ?? "")) {
        res.status(403).json({ error: { code: "forbidden", message: "Your role cannot access keyword mapping intelligence." } });
        return;
    }
    next();
});
async function validateScope(organizationId, input) {
    const [project, website, keyword] = await Promise.all([
        prisma.project.findFirst({ where: { id: input.projectId, organizationId }, select: { id: true } }),
        prisma.domain.findFirst({ where: { id: input.websiteId, organizationId, projectId: input.projectId }, select: { id: true, host: true } }),
        input.keywordId ? prisma.keyword.findFirst({ where: { id: input.keywordId, organizationId }, select: { id: true, phrase: true } }) : Promise.resolve(null),
    ]);
    if (!project)
        throw fail(404, "project_not_found", "Project was not found in this workspace.");
    if (!website)
        throw fail(404, "website_not_found", "Website was not found in the selected project.");
    if (input.keywordId && !keyword)
        throw fail(404, "keyword_not_found", "Keyword was not found in this workspace.");
    return { website, keyword };
}
const historyData = (actorId, action, before, after, note) => ({ actorId, action, before: before == null ? Prisma.JsonNull : before, after: after, note: note ?? null });
keywordMappingRouter.get("/", wrap(async (req, res) => {
    const q = pageQuery.parse(req.query);
    const organizationId = req.auth.organizationId;
    const where = { organizationId, ...(q.projectId ? { projectId: q.projectId } : {}), ...(q.websiteId ? { websiteId: q.websiteId } : {}), ...(q.keywordId ? { keywordId: q.keywordId } : {}), ...(q.status ? { status: q.status } : {}), ...(q.role ? { role: q.role } : {}), ...(q.q ? { OR: [{ phrase: { contains: q.q } }, { pageUrl: { contains: q.q } }] } : {}) };
    const [total, data] = await Promise.all([prisma.keywordPageMapping.count({ where }), prisma.keywordPageMapping.findMany({ where, orderBy: { updatedAt: "desc" }, skip: q.offset, take: q.limit, include: { keyword: { select: { id: true, phrase: true } }, website: { select: { id: true, host: true } }, project: { select: { id: true, name: true } } } })]);
    res.json({ data, pagination: { total, offset: q.offset, limit: q.limit } });
}));
keywordMappingRouter.post("/", wrap(async (req, res) => {
    canWrite(req);
    const input = inputSchema.parse(req.body);
    const org = req.auth.organizationId;
    const { website, keyword } = await validateScope(org, input);
    const page = canonicalPageUrl(input.pageUrl, website.host);
    const phrase = input.phrase.trim();
    const group = input.keywordGroupId ? await prisma.keywordList.findFirst({ where: { id: input.keywordGroupId, organizationId: org, kind: "STRATEGY" }, select: { id: true } }) : null;
    if (input.keywordGroupId && !group)
        throw fail(404, "keyword_group_not_found", "Strategy keyword group was not found in this workspace.");
    const existing = await prisma.keywordPageMapping.findUnique({ where: { organizationId_projectId_phrase_pageKey: { organizationId: org, projectId: input.projectId, phrase, pageKey: page.key } } });
    if (existing) {
        res.status(200).json({ data: existing, idempotent: true });
        return;
    }
    const inferredIntent = classifySearchIntent(phrase);
    const searchIntent = input.searchIntent ?? inferredIntent.intent;
    const confidence = input.confidence ?? (input.searchIntent ? 1 : inferredIntent.confidence);
    let created;
    try {
        created = await prisma.$transaction(async (tx) => {
            const mappedKeyword = input.keywordGroupId ? await tx.keyword.upsert({ where: { organizationId_phrase_locale_searchEngine: { organizationId: org, phrase, locale: "en-US", searchEngine: "google" } }, create: { organizationId: org, phrase, locale: "en-US", searchEngine: "google" }, update: {} }) : keyword;
            if (group && mappedKeyword)
                await tx.keywordListEntry.createMany({ data: [{ listId: group.id, keywordId: mappedKeyword.id }], skipDuplicates: true });
            const row = await tx.keywordPageMapping.create({ data: { organizationId: org, projectId: input.projectId, websiteId: input.websiteId, keywordId: mappedKeyword?.id ?? null, phrase, pageUrl: page.url, pageKey: page.key, role: input.role, searchIntent, confidence, decisionNote: input.decisionNote ?? null, createdById: req.auth.userId, history: { create: historyData(req.auth.userId, "CREATED", null, { projectId: input.projectId, websiteId: input.websiteId, keywordId: mappedKeyword?.id ?? null, keywordGroupId: group?.id ?? null, phrase, pageUrl: page.url, role: input.role, searchIntent, confidence, intentSignals: inferredIntent.signals, intentMethod: input.searchIntent ? "USER_DECLARED" : "RULE_BASED_HEURISTIC", status: "PENDING_REVIEW", decisionNote: input.decisionNote ?? null }, input.decisionNote) } } });
            return row;
        });
    }
    catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            const duplicate = await prisma.keywordPageMapping.findUnique({ where: { organizationId_projectId_phrase_pageKey: { organizationId: org, projectId: input.projectId, phrase, pageKey: page.key } } });
            if (duplicate) {
                res.status(200).json({ data: duplicate, idempotent: true });
                return;
            }
        }
        throw error;
    }
    res.status(201).json({ data: created, idempotent: false });
}));
keywordMappingRouter.get("/:id", wrap(async (req, res) => {
    const id = z.string().min(1).max(191).parse(req.params.id);
    const data = await prisma.keywordPageMapping.findFirst({ where: { id, organizationId: req.auth.organizationId }, include: { keyword: { select: { id: true, phrase: true } }, project: { select: { id: true, name: true } }, website: { select: { id: true, host: true } }, history: { orderBy: { createdAt: "desc" } } } });
    if (!data)
        throw fail(404, "mapping_not_found", "Keyword mapping was not found in this workspace.");
    res.json({ data });
}));
keywordMappingRouter.patch("/:id", wrap(async (req, res) => {
    canWrite(req);
    const id = z.string().min(1).max(191).parse(req.params.id);
    const patchSchema = inputSchema.partial().omit({ projectId: true, websiteId: true });
    const patch = patchSchema.parse(req.body);
    if (!Object.keys(patch).length)
        throw fail(400, "empty_update", "Provide at least one field to update.");
    const org = req.auth.organizationId;
    const before = await prisma.keywordPageMapping.findFirst({ where: { id, organizationId: org }, include: { website: { select: { host: true } } } });
    if (!before)
        throw fail(404, "mapping_not_found", "Keyword mapping was not found in this workspace.");
    if (before.status === "APPROVED")
        throw fail(409, "approved_mapping_locked", "Reopen this mapping before changing an approved decision.");
    if (patch.keywordId) {
        const keyword = await prisma.keyword.findFirst({ where: { id: patch.keywordId, organizationId: org }, select: { id: true } });
        if (!keyword)
            throw fail(404, "keyword_not_found", "Keyword was not found in this workspace.");
    }
    const page = patch.pageUrl ? canonicalPageUrl(patch.pageUrl, before.website.host) : null;
    const phrase = patch.phrase?.trim() ?? before.phrase;
    const after = await prisma.$transaction(async (tx) => {
        const row = await tx.keywordPageMapping.update({ where: { id }, data: { ...patch, phrase, ...(page ? { pageUrl: page.url, pageKey: page.key } : {}), ...(patch.keywordId !== undefined ? { keywordId: patch.keywordId } : {}), ...(patch.searchIntent !== undefined ? { searchIntent: patch.searchIntent } : {}), ...(patch.confidence !== undefined ? { confidence: patch.confidence } : {}), ...(patch.decisionNote !== undefined ? { decisionNote: patch.decisionNote } : {}) } });
        await tx.keywordPageMappingHistory.create({ data: { mappingId: id, ...historyData(req.auth.userId, "UPDATED", before, row, patch.decisionNote) } });
        return row;
    });
    res.json({ data: after });
}));
async function decide(req, res, action) {
    canApprove(req);
    const id = z.string().min(1).max(191).parse(req.params.id);
    const body = z.object({ note: z.string().trim().max(4000).nullable().optional() }).strict().parse(req.body ?? {});
    const org = req.auth.organizationId;
    const before = await prisma.keywordPageMapping.findFirst({ where: { id, organizationId: org } });
    if (!before)
        throw fail(404, "mapping_not_found", "Keyword mapping was not found in this workspace.");
    if (action === "REOPENED" && before.status === "PENDING_REVIEW")
        throw fail(409, "mapping_already_open", "Mapping is already pending review.");
    if (action !== "REOPENED" && before.status !== "PENDING_REVIEW")
        throw fail(409, "mapping_not_pending", "Only mappings pending review can be approved or rejected.");
    if (action === "APPROVED" && before.role === "PRIMARY") {
        const competing = await prisma.keywordPageMapping.findFirst({ where: { organizationId: org, projectId: before.projectId, phrase: before.phrase, role: "PRIMARY", status: "APPROVED", id: { not: before.id } }, select: { id: true, pageUrl: true } });
        if (competing && competing.pageUrl !== before.pageUrl)
            throw fail(409, "primary_target_conflict", "Another page is already approved as the primary target for this keyword. Reopen or change that mapping before approving a different primary URL.");
    }
    const nextStatus = action === "APPROVED" ? "APPROVED" : action === "REJECTED" ? "REJECTED" : "PENDING_REVIEW";
    const after = await prisma.$transaction(async (tx) => { const row = await tx.keywordPageMapping.update({ where: { id }, data: { status: nextStatus, decisionNote: body.note ?? before.decisionNote, approvedById: action === "APPROVED" ? req.auth.userId : null, approvedAt: action === "APPROVED" ? new Date() : null } }); await tx.keywordPageMappingHistory.create({ data: { mappingId: id, ...historyData(req.auth.userId, action, before, row, body.note) } }); return row; });
    res.json({ data: after });
}
keywordMappingRouter.post("/:id/approve", wrap((req, res) => decide(req, res, "APPROVED")));
keywordMappingRouter.post("/:id/reject", wrap((req, res) => decide(req, res, "REJECTED")));
keywordMappingRouter.post("/:id/reopen", wrap((req, res) => decide(req, res, "REOPENED")));
keywordMappingRouter.post("/:id/task", wrap(async (req, res) => {
    canWrite(req);
    const mappingId = z.string().min(1).max(191).parse(req.params.id);
    const org = req.auth.organizationId;
    const mapping = await prisma.keywordPageMapping.findFirst({ where: { id: mappingId, organizationId: org }, include: { project: { select: { id: true } }, website: { select: { id: true } }, history: { orderBy: { createdAt: "desc" }, take: 5 } } });
    if (!mapping)
        throw fail(404, "mapping_not_found", "Keyword mapping was not found in this workspace.");
    if (mapping.status !== "APPROVED")
        throw fail(409, "mapping_approval_required", "Approve the mapping decision before creating an implementation task.");
    const dedupeKey = `KEYWORD_MAPPING:${mapping.id}:SEO_TASK`;
    const existing = await prisma.seoTask.findFirst({ where: { organizationId: org, dedupeKey } });
    if (existing) {
        res.json({ data: existing, idempotent: true });
        return;
    }
    const data = await prisma.seoTask.create({ data: { organizationId: org, projectId: mapping.projectId, websiteId: mapping.websiteId, title: `Implement keyword targeting for “${mapping.phrase}”`.slice(0, 200), description: `Apply the approved primary page assignment for ${mapping.phrase}: ${mapping.pageUrl}. Preserve the previous targeting and verify any content or internal-link changes before completion.`, category: "SEO_STRATEGY", priority: "P2", severity: "MEDIUM", status: "TODO", sourceModule: "KEYWORD_PAGE_MAPPING", sourceEntityType: "KeywordPageMapping", sourceEntityId: mapping.id, sourceEvidence: { mapping: { id: mapping.id, phrase: mapping.phrase, pageUrl: mapping.pageUrl, role: mapping.role, searchIntent: mapping.searchIntent, approvedAt: mapping.approvedAt, approvedById: mapping.approvedById }, history: mapping.history.map((entry) => ({ action: entry.action, note: entry.note, createdAt: entry.createdAt })) }, affectedUrls: [mapping.pageUrl], targetKeywords: [mapping.phrase], labels: ["keyword-mapping"], acceptanceCriteria: ["Approved URL remains the assigned primary target.", "Related content and internal links are reviewed for targeting consistency."], createdById: req.auth.userId, dedupeKey } });
    await prisma.seoTaskActivity.create({ data: { taskId: data.id, actorId: req.auth.userId, action: "TASK_CREATED_FROM_KEYWORD_MAPPING", metadata: { mappingId: mapping.id } } });
    res.status(201).json({ data, idempotent: false });
}));
keywordMappingRouter.post("/import/rankings", wrap(async (req, res) => {
    canWrite(req);
    const input = z.object({ projectId: z.string().min(1), websiteId: z.string().min(1), limit: z.number().int().min(1).max(500).default(200) }).strict().parse(req.body);
    const org = req.auth.organizationId;
    const domain = await prisma.domain.findFirst({ where: { id: input.websiteId, projectId: input.projectId, organizationId: org }, select: { id: true, host: true } });
    if (!domain)
        throw fail(404, "website_not_found", "Website was not found in the selected project.");
    const observations = await prisma.ranking.findMany({ where: { domainId: domain.id, url: { not: null } }, orderBy: [{ observedAt: "desc" }, { id: "desc" }], take: 5000 });
    const latest = new Map();
    for (const row of observations) {
        const phraseKey = row.keyword.trim().toLocaleLowerCase();
        if (phraseKey && !latest.has(phraseKey))
            latest.set(phraseKey, row);
    }
    const candidates = [...latest.values()].slice(0, input.limit);
    let imported = 0;
    let skippedExternalOrInvalid = 0;
    let alreadyMapped = 0;
    try {
        await prisma.$transaction(async (tx) => {
            for (const row of candidates) {
                if (!row.url)
                    continue;
                let page;
                try {
                    page = canonicalPageUrl(row.url, domain.host);
                }
                catch {
                    skippedExternalOrInvalid += 1;
                    continue;
                }
                const phrase = row.keyword.trim();
                const existing = await tx.keywordPageMapping.findUnique({ where: { organizationId_projectId_phrase_pageKey: { organizationId: org, projectId: input.projectId, phrase, pageKey: page.key } }, select: { id: true } });
                if (existing) {
                    alreadyMapped += 1;
                    continue;
                }
                const keyword = await tx.keyword.findFirst({ where: { organizationId: org, phrase }, select: { id: true } });
                const intent = classifySearchIntent(phrase);
                const after = { projectId: input.projectId, websiteId: domain.id, keywordId: keyword?.id ?? null, phrase, pageUrl: page.url, role: "PRIMARY", searchIntent: intent.intent, confidence: intent.confidence, intentSignals: intent.signals, intentMethod: "RULE_BASED_HEURISTIC", status: "PENDING_REVIEW", source: "RANK_TRACKING", rankingId: row.id, position: row.position, observedAt: row.observedAt };
                await tx.keywordPageMapping.create({ data: { organizationId: org, projectId: input.projectId, websiteId: domain.id, keywordId: keyword?.id ?? null, phrase, pageUrl: page.url, pageKey: page.key, role: "PRIMARY", searchIntent: intent.intent, confidence: intent.confidence, status: "PENDING_REVIEW", createdById: req.auth.userId, history: { create: historyData(req.auth.userId, "IMPORTED_FROM_RANK_TRACKING", null, after, `Observed position ${row.position ?? "unknown"} at ${row.observedAt.toISOString()}`) } } });
                imported += 1;
            }
        });
    }
    catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
            throw fail(409, "mapping_import_conflict", "Another request imported one of these rankings concurrently. Refresh mappings and retry.");
        throw error;
    }
    await prisma.activityLog.create({ data: { organizationId: org, userId: req.auth.userId, action: "keyword_mapping.rankings_imported", entityType: "Domain", entityId: domain.id, metadata: { imported, alreadyMapped, skippedExternalOrInvalid, requestedLimit: input.limit } } });
    res.status(201).json({ imported, alreadyMapped, skippedExternalOrInvalid, note: "Only the latest saved ranking URL per keyword is imported; records are pending review and external/non-HTTPS URLs are skipped." });
}));
keywordMappingRouter.post("/analysis/search-console", wrap(async (req, res) => {
    const input = z.object({ projectId: z.string().min(1), websiteId: z.string().min(1), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u) }).strict().parse(req.body);
    const org = req.auth.organizationId;
    const domain = await prisma.domain.findFirst({ where: { id: input.websiteId, projectId: input.projectId, organizationId: org }, select: { id: true, host: true } });
    if (!domain)
        throw fail(404, "website_not_found", "Website was not found in the selected project.");
    const start = new Date(`${input.startDate}T00:00:00.000Z`);
    const end = new Date(`${input.endDate}T00:00:00.000Z`);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end || end > today || end.getTime() - start.getTime() > 92 * 86_400_000)
        throw fail(400, "invalid_date_range", "Choose a date range of up to 93 days ending today or earlier.");
    const integration = await prisma.integration.findUnique({ where: { organizationId_provider: { organizationId: org, provider: "google-search-console" } } });
    if (!integration?.encryptedCredentials || integration.status !== "connected") {
        res.json({ data: null, status: "not_connected", note: "Connect Google Search Console and select an accessible property in Settings to view query-to-page evidence." });
        return;
    }
    const tokens = await readEncryptedTokens(integration.encryptedCredentials);
    if (!tokens.accountId) {
        res.json({ data: null, status: "account_required", note: "Select an accessible Search Console property in Settings." });
        return;
    }
    const normalizedHost = domain.host.toLocaleLowerCase().replace(/^www\./u, "");
    const selectedPropertyHost = tokens.accountId.startsWith("sc-domain:") ? tokens.accountId.slice("sc-domain:".length).toLocaleLowerCase().replace(/^www\./u, "") : (() => { try {
        return new URL(tokens.accountId).hostname.toLocaleLowerCase().replace(/^www\./u, "");
    }
    catch {
        return "";
    } })();
    if (selectedPropertyHost !== normalizedHost)
        throw fail(409, "search_console_property_mismatch", "The selected Search Console property does not match this website. Select the correct property in Settings.");
    try {
        const config = googleConfig("google-search-console", await getWorkspaceProviderCredentials(org, "google-search-console"));
        const result = await getGoogleReport(config, tokens, { startDate: input.startDate, endDate: input.endDate, dimensions: ["query", "page"] });
        const payload = result.report && typeof result.report === "object" ? result.report : {};
        const pageHost = normalizedHost;
        const groups = new Map();
        const dropped = { outsideWebsite: 0, malformed: 0 };
        for (const item of payload.rows ?? []) {
            if (!item || typeof item !== "object") {
                dropped.malformed += 1;
                continue;
            }
            const row = item;
            const phrase = typeof row.keys?.[0] === "string" ? row.keys[0].trim() : "";
            const page = typeof row.keys?.[1] === "string" ? row.keys[1] : "";
            let parsed;
            try {
                parsed = new URL(page);
            }
            catch {
                dropped.malformed += 1;
                continue;
            }
            if (parsed.protocol !== "https:" || parsed.hostname.toLocaleLowerCase().replace(/^www\./u, "") !== pageHost) {
                dropped.outsideWebsite += 1;
                continue;
            }
            if (!phrase)
                continue;
            groups.set(phrase.toLocaleLowerCase(), [...(groups.get(phrase.toLocaleLowerCase()) ?? []), { phrase, page: parsed.toString(), clicks: row.clicks ?? 0, impressions: row.impressions ?? 0, ctr: row.ctr ?? 0, averagePosition: row.position ?? null }]);
        }
        const data = [...groups.values()].map((rows) => ({ phrase: rows[0].phrase, pages: rows.sort((a, b) => b.impressions - a.impressions), multiplePages: new Set(rows.map((row) => row.page)).size > 1, interpretation: new Set(rows.map((row) => row.page)).size > 1 ? "OVERLAP_CANDIDATE_REQUIRES_INTENT_REVIEW" : "SINGLE_OBSERVED_PAGE" }));
        await prisma.integration.update({ where: { organizationId_provider: { organizationId: org, provider: "google-search-console" } }, data: { encryptedCredentials: encryptedTokenRecord(result.tokens), lastCheckedAt: new Date(), status: "connected" } });
        await prisma.apiUsage.create({ data: { organizationId: org, provider: "google-search-console", operation: "keyword_mapping_query_page_analysis", units: 1, status: "succeeded" } });
        await prisma.activityLog.create({ data: { organizationId: org, userId: req.auth.userId, action: "keyword_mapping.search_console_analysis", entityType: "Domain", entityId: domain.id, metadata: { startDate: input.startDate, endDate: input.endDate, rows: data.length, multiplePageQueries: data.filter((row) => row.multiplePages).length } } });
        res.json({ data, status: "connected", source: "Google Search Console API", confidence: "FIRST_PARTY", dateRange: { startDate: input.startDate, endDate: input.endDate }, droppedRows: dropped, note: "Multiple query-to-page rows indicate an overlap candidate only. Review each page's search intent and SERP evidence before treating it as cannibalization; low-volume queries may be omitted by Google." });
    }
    catch (error) {
        await prisma.apiUsage.create({ data: { organizationId: org, provider: "google-search-console", operation: "keyword_mapping_query_page_analysis", units: 1, status: "failed" } });
        throw fail(error instanceof GoogleIntegrationFailure ? error.status ?? 502 : 502, error instanceof GoogleIntegrationFailure ? error.code : "search_console_request_failed", error instanceof GoogleIntegrationFailure ? error.message : "Search Console query-to-page evidence could not be retrieved.");
    }
}));
/** Stored Ranking/SERP analysis; a separate live Search Console route returns dated query/page observations. */
keywordMappingRouter.get("/analysis/overview", wrap(async (req, res) => {
    const q = z.object({ projectId: z.string().min(1), websiteId: z.string().min(1), offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
    const org = req.auth.organizationId;
    const domain = await prisma.domain.findFirst({ where: { id: q.websiteId, projectId: q.projectId, organizationId: org }, select: { id: true } });
    if (!domain)
        throw fail(404, "website_not_found", "Website was not found in the selected project.");
    const [total, mappings] = await Promise.all([prisma.keywordPageMapping.count({ where: { organizationId: org, projectId: q.projectId, websiteId: q.websiteId } }), prisma.keywordPageMapping.findMany({ where: { organizationId: org, projectId: q.projectId, websiteId: q.websiteId }, orderBy: { updatedAt: "desc" }, skip: q.offset, take: q.limit })]);
    const evidence = await Promise.all(mappings.map(async (mapping) => {
        const [rankings, serp] = await Promise.all([
            prisma.ranking.findMany({ where: { domainId: domain.id, keyword: mapping.phrase }, orderBy: { observedAt: "desc" }, take: 20 }),
            mapping.keywordId ? prisma.serpResult.findMany({ where: { keywordId: mapping.keywordId }, orderBy: [{ observedAt: "desc" }, { rank: "asc" }], take: 100 }) : Promise.resolve([]),
        ]);
        const latestSerpAt = serp[0]?.observedAt?.getTime();
        const latestRows = latestSerpAt ? serp.filter((x) => x.observedAt.getTime() === latestSerpAt) : [];
        return { mappingId: mapping.id, phrase: mapping.phrase, targetUrl: mapping.pageUrl, ranking: rankings.slice(0, 10), serp: latestRows, competingUrls: [...new Set(rankings.map((x) => x.url).filter((url) => Boolean(url) && url !== mapping.pageUrl))], evidenceCoverage: { ranking: rankings.length ? "AVAILABLE" : "NO_SAVED_DATA", serp: latestRows.length ? "AVAILABLE" : mapping.keywordId ? "NO_SAVED_DATA" : "KEYWORD_NOT_LINKED", searchConsole: "NOT_CONNECTED_TO_THIS_ANALYSIS" } };
    }));
    res.json({ data: evidence, pagination: { total, offset: q.offset, limit: q.limit }, sourceCoverage: { ranking: "SAVED_RANKING_RECORDS", serp: "SAVED_SERP_RESULT_RECORDS", searchConsole: { status: "NOT_CONNECTED_TO_THIS_ANALYSIS", explanation: "No query-to-page Search Console evidence is included; conclusions use saved rank and SERP data only." } } });
}));
