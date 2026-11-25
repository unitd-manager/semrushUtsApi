import { Router, type NextFunction, type Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db.js";
import { requireAuth, type AuthenticatedRequest } from "./auth.js";
import { encryptedTokenRecord, getGoogleReport, googleConfig, GoogleIntegrationFailure, readEncryptedTokens } from "./google-integrations.js";
import { compareContentSections, findUnsupportedClaimCandidates } from "./content-analysis.js";
import { getWorkspaceProviderCredentials } from "./workspace-integrations.js";

export const contentVersionRouter = Router();
const editorRoles = ["OWNER", "ADMIN", "MANAGER", "ANALYST"];
const managerRoles = ["OWNER", "ADMIN", "MANAGER"];
function fail(statusCode: number, code: string, message: string) { return Object.assign(new Error(message), { statusCode, code }); }
function handle(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof z.ZodError) { res.status(400).json({ error: { code: "validation_error", message: "Check the submitted fields.", fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) } }); return; }
  if (error && typeof error === "object" && "statusCode" in error) { const item = error as { statusCode: number; code?: string; message?: string }; res.status(item.statusCode).json({ error: { code: item.code ?? "content_version_request_failed", message: item.message ?? "The content version request could not be completed." } }); return; }
  next(error);
}
const wrap = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => { void fn(req, res).catch((error) => handle(error, res, next)); };
contentVersionRouter.use(requireAuth);

contentVersionRouter.get("/:id/performance", wrap(async (req, res) => {
  const id = z.string().min(1).max(191).parse(req.params.id);
  const input = z.object({ startDate: z.string().date(), endDate: z.string().date() }).parse(req.query);
  const start = new Date(`${input.startDate}T00:00:00.000Z`); const end = new Date(`${input.endDate}T00:00:00.000Z`);
  if (end < start || end.getTime() - start.getTime() > 90 * 86_400_000 || end >= new Date(new Date().toISOString().slice(0, 10))) throw fail(400, "invalid_performance_date_range", "Use a date range of up to 90 days ending before today.");
  const org = req.auth!.organizationId; const piece = await contentInWorkspace(id, org);
  if (!piece.url) throw fail(409, "content_url_required", "Add the page's public URL to this content piece before requesting Search Console data.");
  let page: URL; try { page = new URL(piece.url); } catch { throw fail(400, "content_url_invalid", "The saved content URL is invalid."); }
  if (page.protocol !== "https:" || page.username || page.password || page.search || page.hash) throw fail(400, "content_url_invalid", "Search Console analysis requires a public HTTPS page URL without credentials, query, or fragment.");
  const host = page.hostname.toLocaleLowerCase().replace(/^www\./u, "");
  const domain = await prisma.domain.findFirst({ where: { organizationId: org, host: { in: [host, `www.${host}`] } }, select: { id: true, host: true, projectId: true } });
  if (!domain) throw fail(409, "content_domain_unlinked", "The page URL must match a website registered to a project in this workspace.");
  const integration = await prisma.integration.findUnique({ where: { organizationId_provider: { organizationId: org, provider: "google-search-console" } } });
  if (!integration?.encryptedCredentials || integration.status !== "connected") { res.json({ data: null, status: "not_connected", note: "Connect Google Search Console in Settings to load first-party page performance." }); return; }
  const tokens = await readEncryptedTokens(integration.encryptedCredentials);
  if (!tokens.accountId) { res.json({ data: null, status: "account_required", note: "Select the matching Search Console property in Settings." }); return; }
  let propertyMatches = false;
  if (tokens.accountId.startsWith("sc-domain:")) {
    const propertyHost = tokens.accountId.slice("sc-domain:".length).toLocaleLowerCase().replace(/^www\./u, "");
    propertyMatches = host === propertyHost || host.endsWith(`.${propertyHost}`);
  } else {
    try {
      const property = new URL(tokens.accountId); const prefixPath = property.pathname.endsWith("/") ? property.pathname : `${property.pathname}/`;
      propertyMatches = property.protocol === "https:" && property.origin === page.origin && (page.pathname === property.pathname || page.pathname.startsWith(prefixPath));
    } catch { propertyMatches = false; }
  }
  if (!propertyMatches) throw fail(409, "search_console_property_mismatch", "The selected Search Console property does not cover this page. Select the correct property in Settings.");
  const normalizedPage = `${page.origin}${page.pathname}`;
  try {
    const config = googleConfig("google-search-console", await getWorkspaceProviderCredentials(org, "google-search-console"));
    const result = await getGoogleReport(config, tokens, { startDate: input.startDate, endDate: input.endDate, dimensions: ["query"], dimensionFilters: [{ dimension: "page", operator: "equals", expression: normalizedPage }] });
    const payload = result.report && typeof result.report === "object" ? result.report as { rows?: unknown[] } : {};
    const rows = (payload.rows ?? []).flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const row = value as { keys?: unknown[]; clicks?: number; impressions?: number; ctr?: number; position?: number };
      const query = typeof row.keys?.[0] === "string" ? row.keys[0].trim() : "";
      if (!query) return [];
      return [{ query, clicks: Number.isFinite(row.clicks) ? row.clicks! : 0, impressions: Number.isFinite(row.impressions) ? row.impressions! : 0, ctr: Number.isFinite(row.ctr) ? row.ctr! : 0, averagePosition: Number.isFinite(row.position) ? row.position! : null }];
    }).sort((a, b) => b.impressions - a.impressions);
    const clicks = rows.reduce((sum, row) => sum + row.clicks, 0); const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
    const weightedPosition = rows.reduce((sum, row) => sum + (row.averagePosition ?? 0) * row.impressions, 0);
    await prisma.integration.update({ where: { organizationId_provider: { organizationId: org, provider: "google-search-console" } }, data: { encryptedCredentials: encryptedTokenRecord(result.tokens), lastCheckedAt: new Date(), status: "connected" } });
    await prisma.apiUsage.create({ data: { organizationId: org, provider: "google-search-console", operation: "content_page_performance", units: 1, status: "succeeded" } });
    await audit(org, req.auth!.userId, "content.search_console_performance_loaded", id, { websiteId: domain.id, pageUrl: normalizedPage, startDate: input.startDate, endDate: input.endDate, queryRows: rows.length });
    res.json({ data: { pageUrl: normalizedPage, startDate: input.startDate, endDate: input.endDate, source: "Google Search Console", confidence: "FIRST_PARTY", clicks, impressions, ctr: impressions ? clicks / impressions : 0, averagePosition: impressions ? weightedPosition / impressions : null, queries: rows.slice(0, 100), returnedQueryCount: rows.length }, status: "connected", note: "Search Console may omit low-volume queries. Metrics describe the selected URL and date range; they do not prove a specific content change caused performance movement." });
  } catch (error) {
    await prisma.apiUsage.create({ data: { organizationId: org, provider: "google-search-console", operation: "content_page_performance", units: 1, status: "failed" } });
    throw fail(error instanceof GoogleIntegrationFailure ? error.status ?? 502 : 502, error instanceof GoogleIntegrationFailure ? error.code : "search_console_request_failed", error instanceof GoogleIntegrationFailure ? error.message : "Search Console page performance could not be retrieved.");
  }
}));

async function contentInWorkspace(id: string, organizationId: string) {
  const piece = await prisma.contentPiece.findFirst({ where: { id, organizationId } });
  if (!piece) throw fail(404, "content_piece_not_found", "Content was not found in this workspace.");
  return piece;
}
async function audit(organizationId: string, userId: string, action: string, entityId: string, metadata: Record<string, unknown>) {
  await prisma.activityLog.create({ data: { organizationId, userId, action, entityType: "ContentPiece", entityId, metadata: metadata as Prisma.InputJsonValue } });
}
const pageQuery = z.object({ offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(100).default(25) });
const contentFields = z.object({ title: z.string().trim().min(1).max(500).optional(), url: z.string().trim().max(2048).nullable().optional(), body: z.string().max(1_000_000).nullable().optional(), targetKeyword: z.string().trim().max(500).nullable().optional(), status: z.string().trim().min(1).max(80).optional(), changeNote: z.string().trim().max(2000).nullable().optional() }).strict();

// Every save creates a complete immutable snapshot. The live ContentPiece remains the draft workspace;
// CMS publishing continues through the existing publishing boundary.
contentVersionRouter.get("/:id/versions", wrap(async (req, res) => {
  const id = z.string().min(1).max(191).parse(req.params.id); const query = pageQuery.parse(req.query);
  await contentInWorkspace(id, req.auth!.organizationId);
  const where = { organizationId: req.auth!.organizationId, contentPieceId: id };
  const [total, data] = await Promise.all([prisma.contentVersion.count({ where }), prisma.contentVersion.findMany({ where, orderBy: { version: "desc" }, skip: query.offset, take: query.limit } )]);
  res.json({ data, pagination: { total, offset: query.offset, limit: query.limit, hasMore: query.offset + data.length < total } });
}));

contentVersionRouter.get("/:id/versions/:versionId", wrap(async (req, res) => {
  const id = z.string().min(1).max(191).parse(req.params.id); const versionId = z.string().min(1).max(191).parse(req.params.versionId);
  await contentInWorkspace(id, req.auth!.organizationId);
  const data = await prisma.contentVersion.findFirst({ where: { id: versionId, contentPieceId: id, organizationId: req.auth!.organizationId }, include: { reviews: { orderBy: { createdAt: "desc" } } } });
  if (!data) throw fail(404, "content_version_not_found", "Content version was not found in this workspace.");
  res.json({ data });
}));

contentVersionRouter.get("/:id/versions/:versionId/diff", wrap(async (req, res) => {
  const id = z.string().min(1).max(191).parse(req.params.id); const versionId = z.string().min(1).max(191).parse(req.params.versionId); const org = req.auth!.organizationId;
  await contentInWorkspace(id, org);
  const version = await prisma.contentVersion.findFirst({ where: { id: versionId, contentPieceId: id, organizationId: org } });
  if (!version) throw fail(404, "content_version_not_found", "Content version was not found in this workspace.");
  const previous = await prisma.contentVersion.findFirst({ where: { contentPieceId: id, organizationId: org, version: { lt: version.version } }, orderBy: { version: "desc" } });
  res.json({ data: { versionId: version.id, version: version.version, previousVersionId: previous?.id ?? null, previousVersion: previous?.version ?? null, title: { before: previous?.title ?? null, after: version.title }, targetKeyword: { before: previous?.targetKeyword ?? null, after: version.targetKeyword }, sections: compareContentSections(previous?.body ?? null, version.body) } });
}));

contentVersionRouter.get("/:id/claim-review", wrap(async (req, res) => {
  const id = z.string().min(1).max(191).parse(req.params.id); const org = req.auth!.organizationId;
  await contentInWorkspace(id, org);
  const version = await prisma.contentVersion.findFirst({ where: { contentPieceId: id, organizationId: org }, orderBy: { version: "desc" }, select: { id: true, version: true, body: true } });
  if (!version) throw fail(409, "content_version_required", "Save a content version before reviewing claim-like wording.");
  res.json({ data: { versionId: version.id, version: version.version, candidates: findUnsupportedClaimCandidates(version.body), limitation: "This deterministic wording scan only identifies phrases that may need citations. It cannot verify truth, sourcing, or context; human editorial review is required." } });
}));

contentVersionRouter.post("/:id/versions", wrap(async (req, res) => {
  if (!editorRoles.includes(req.auth!.role)) throw fail(403, "content_edit_forbidden", "Your role cannot save content versions.");
  const id = z.string().min(1).max(191).parse(req.params.id); const input = contentFields.parse(req.body); const org = req.auth!.organizationId;
  if (!Object.keys(input).some((key) => key !== "changeNote")) throw fail(400, "empty_content_version", "Provide at least one content field to save.");
  const piece = await contentInWorkspace(id, org);
  const saved = await prisma.$transaction(async (tx) => {
    const latest = await tx.contentVersion.findFirst({ where: { organizationId: org, contentPieceId: id }, orderBy: { version: "desc" }, select: { version: true } });
    const snapshot = { title: input.title ?? piece.title, url: input.url === undefined ? piece.url : input.url, body: input.body === undefined ? piece.body : input.body, targetKeyword: input.targetKeyword === undefined ? piece.targetKeyword : input.targetKeyword, status: input.status ?? piece.status };
    await tx.contentPiece.update({ where: { id }, data: snapshot });
    return tx.contentVersion.create({ data: { organizationId: org, contentPieceId: id, version: (latest?.version ?? 0) + 1, ...snapshot, changeNote: input.changeNote ?? null, createdById: req.auth!.userId } });
  });
  await audit(org, req.auth!.userId, "content.version_saved", id, { versionId: saved.id, version: saved.version, changeNote: saved.changeNote });
  res.status(201).json({ data: saved });
}));

contentVersionRouter.post("/:id/versions/:versionId/restore", wrap(async (req, res) => {
  if (!editorRoles.includes(req.auth!.role)) throw fail(403, "content_edit_forbidden", "Your role cannot restore content versions.");
  const id = z.string().min(1).max(191).parse(req.params.id); const versionId = z.string().min(1).max(191).parse(req.params.versionId); const input = z.object({ changeNote: z.string().trim().max(2000).nullable().optional() }).strict().parse(req.body);
  const org = req.auth!.organizationId; await contentInWorkspace(id, org);
  const source = await prisma.contentVersion.findFirst({ where: { id: versionId, contentPieceId: id, organizationId: org } });
  if (!source) throw fail(404, "content_version_not_found", "Content version was not found in this workspace.");
  const restored = await prisma.$transaction(async (tx) => {
    const latest = await tx.contentVersion.findFirst({ where: { organizationId: org, contentPieceId: id }, orderBy: { version: "desc" }, select: { version: true } });
    const snapshot = { title: source.title, url: source.url, body: source.body, targetKeyword: source.targetKeyword, status: source.status };
    await tx.contentPiece.update({ where: { id }, data: snapshot });
    return tx.contentVersion.create({ data: { organizationId: org, contentPieceId: id, version: (latest?.version ?? 0) + 1, ...snapshot, changeNote: input.changeNote ?? `Restored from version ${source.version}`, createdById: req.auth!.userId } });
  });
  await audit(org, req.auth!.userId, "content.version_restored", id, { sourceVersionId: source.id, sourceVersion: source.version, restoredVersionId: restored.id, version: restored.version });
  res.status(201).json({ data: restored });
}));

contentVersionRouter.get("/:id/reviews", wrap(async (req, res) => {
  const id = z.string().min(1).max(191).parse(req.params.id); const query = pageQuery.parse(req.query); const org = req.auth!.organizationId;
  await contentInWorkspace(id, org); const where = { organizationId: org, contentPieceId: id };
  const [total, data] = await Promise.all([prisma.contentReview.count({ where }), prisma.contentReview.findMany({ where, orderBy: { createdAt: "desc" }, skip: query.offset, take: query.limit, include: { version: true } })]);
  res.json({ data, pagination: { total, offset: query.offset, limit: query.limit, hasMore: query.offset + data.length < total } });
}));

contentVersionRouter.post("/:id/reviews", wrap(async (req, res) => {
  if (!editorRoles.includes(req.auth!.role)) throw fail(403, "content_review_forbidden", "Your role cannot request content review.");
  const id = z.string().min(1).max(191).parse(req.params.id); const input = z.object({ versionId: z.string().min(1).max(191).optional(), comments: z.string().trim().max(10000).nullable().optional() }).strict().parse(req.body); const org = req.auth!.organizationId;
  await contentInWorkspace(id, org);
  const version = input.versionId ? await prisma.contentVersion.findFirst({ where: { id: input.versionId, contentPieceId: id, organizationId: org } }) : await prisma.contentVersion.findFirst({ where: { contentPieceId: id, organizationId: org }, orderBy: { version: "desc" } });
  if (!version) throw fail(409, "content_version_required", "Save a version before requesting review.");
  const review = await prisma.contentReview.create({ data: { organizationId: org, contentPieceId: id, versionId: version.id, reviewerId: null, status: "PENDING", comments: input.comments ?? null } });
  await audit(org, req.auth!.userId, "content.review_requested", id, { reviewId: review.id, versionId: version.id }); res.status(201).json({ data: review });
}));

contentVersionRouter.patch("/:id/reviews/:reviewId", wrap(async (req, res) => {
  if (!managerRoles.includes(req.auth!.role)) throw fail(403, "content_review_decision_forbidden", "Only workspace managers can approve or reject content.");
  const id = z.string().min(1).max(191).parse(req.params.id); const reviewId = z.string().min(1).max(191).parse(req.params.reviewId); const input = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), comments: z.string().trim().max(10000).nullable().optional() }).strict().parse(req.body); const org = req.auth!.organizationId;
  await contentInWorkspace(id, org); const existing = await prisma.contentReview.findFirst({ where: { id: reviewId, contentPieceId: id, organizationId: org } });
  if (!existing) throw fail(404, "content_review_not_found", "Review was not found in this workspace.");
  if (existing.status !== "PENDING") throw fail(409, "content_review_already_decided", "This review already has a decision.");
  const changed = await prisma.contentReview.updateMany({ where: { id: reviewId, contentPieceId: id, organizationId: org, status: "PENDING" }, data: { status: input.decision, comments: input.comments === undefined ? existing.comments : input.comments, reviewedAt: new Date(), reviewerId: req.auth!.userId } });
  if (!changed.count) throw fail(409, "content_review_already_decided", "This review was decided by another reviewer.");
  const saved = await prisma.contentReview.findUniqueOrThrow({ where: { id: reviewId } });
  await audit(org, req.auth!.userId, `content.review_${input.decision.toLowerCase()}`, id, { reviewId, versionId: existing.versionId, comments: input.comments ?? null }); res.json({ data: saved });
}));
