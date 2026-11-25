import { Router, type NextFunction, type Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db.js";
import { requireAuth, type AuthenticatedRequest } from "./auth.js";
import { runSiteAudit } from "./crawler.js";
import { changedPageFields, changeRisk, eventDedupeKey, type PageState } from "./competitor-monitoring-core.js";

export const competitorMonitoringRouter = Router();
competitorMonitoringRouter.use(requireAuth);
const managers = ["OWNER", "ADMIN", "MANAGER"];
const id = z.string().trim().min(1).max(191);
const paging = z.object({ offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(100).default(50) });
const monitorInput = z.object({ projectId: id, websiteId: id, competitorId: id, frequencyHours: z.number().int().min(24).max(720).default(24) }).strict();
const errorResponse = (error: unknown, res: Response, next: NextFunction) => {
  if (error instanceof z.ZodError) { res.status(400).json({ error: { code: "validation_error", message: "Check the submitted fields.", fields: error.issues.map((item) => ({ path: item.path.join("."), message: item.message })) } }); return; }
  if (error && typeof error === "object" && "status" in error && typeof error.status === "number") { const e = error as { status: number; code?: string; message?: string }; res.status(e.status).json({ error: { code: e.code ?? "competitor_monitoring_error", message: e.message ?? "The request could not be completed." } }); return; }
  next(error);
};
function wrap(fn: (req: AuthenticatedRequest, res: Response) => Promise<void>) { return (req: AuthenticatedRequest, res: Response, next: NextFunction) => { void fn(req, res).catch((error) => errorResponse(error, res, next)); }; }
function manager(req: AuthenticatedRequest) { if (!managers.includes(req.auth!.role)) throw Object.assign(new Error("A workspace manager must perform this action."), { status: 403, code: "manager_required" }); }
function notFound() { return Object.assign(new Error("The competitor monitoring record was not found in this workspace."), { status: 404, code: "not_found" }); }
const coverageNote = "Observations are a bounded sample (up to 20 HTTPS pages discovered through the public sitemap and same-host links), not a complete record of competitor changes. Missing pages may be undiscovered or blocked; no ranking, traffic, or causal impact is inferred. A monitor becomes stale when lastRunAt is older than its configured interval.";

async function scopedMonitor(organizationId: string, monitorId: string) {
  const monitor = await prisma.competitorMonitor.findFirst({ where: { id: monitorId, organizationId, competitor: { domain: { organizationId } } }, include: { competitor: { include: { domain: { select: { id: true, host: true } } } }, website: { select: { id: true, host: true } }, project: { select: { id: true, name: true } } } });
  if (!monitor) throw notFound(); return monitor;
}

async function captureMonitor(monitor: Awaited<ReturnType<typeof scopedMonitor>>, started: Date) {
  const audit = await runSiteAudit(monitor.competitor.host, 20);
  const pages = audit.pages.map((page) => ({ page, state: { statusCode: page.statusCode, title: page.title, description: page.description, h1: page.h1, canonical: page.canonical, robots: page.robots, contentDigest: page.contentDigest } satisfies PageState }));
  return await prisma.$transaction(async (tx) => {
    let snapshots = 0; let newHighRiskChanges = 0;
    for (const item of pages) {
      const prior = await tx.competitorPageSnapshot.findFirst({ where: { monitorId: monitor.id, url: item.page.url }, orderBy: { observedAt: "desc" } });
      const snapshot = await tx.competitorPageSnapshot.create({ data: { competitorId: monitor.competitorId, monitorId: monitor.id, url: item.page.url, observedAt: started, statusCode: item.page.statusCode, title: item.page.title, description: item.page.description, h1: item.page.h1, canonical: item.page.canonical, robots: item.page.robots, contentDigest: item.page.contentDigest, headings: [item.page.h1].filter(Boolean) as Prisma.InputJsonValue, provider: "searchlight_bounded_crawler", confidence: "SAMPLE" } });
      snapshots++;
      const before = prior ? prior as unknown as PageState : null; const fields = changedPageFields(before, item.state);
      if (!prior || !fields.length) continue;
      const risk = changeRisk(fields, before, item.state);
      const dedupeKey = eventDedupeKey(monitor.id, item.page.url, prior.id, fields, item.state);
      const inserted = await tx.competitorChangeEvent.createMany({ skipDuplicates: true, data: [{ competitorId: monitor.competitorId, monitorId: monitor.id, beforeSnapshotId: prior.id, afterSnapshotId: snapshot.id, changeType: fields.join("_"), risk, status: "OPEN", dedupeKey, evidence: { fields, before: Object.fromEntries(fields.map((field) => [field, before?.[field] ?? null])), after: Object.fromEntries(fields.map((field) => [field, item.state[field]])), method: "bounded_https_crawl" } as Prisma.InputJsonValue }] });
      if (inserted.count && risk === "HIGH") newHighRiskChanges++;
    }
    const nextRunAt = new Date(started.getTime() + monitor.frequencyHours * 3600_000);
    await tx.competitorMonitor.update({ where: { id: monitor.id }, data: { lastRunAt: started, nextRunAt } });
    if (newHighRiskChanges) await tx.notification.create({ data: { organizationId: monitor.organizationId, kind: "COMPETITOR_CHANGE_HIGH_RISK", title: "High-risk competitor website changes detected", body: `${newHighRiskChanges} high-risk change${newHighRiskChanges === 1 ? "" : "s"} detected for ${monitor.competitor.host}. Review the competitor change log.` } });
    return { snapshots, pagesConsidered: audit.pagesConsidered, issues: audit.issues.length, newHighRiskChanges, nextRunAt };
  });
}

/** Run due monitors once per invocation; nextRunAt is advanced atomically before crawling to exclude competing workers. */
export async function runDueCompetitorMonitors(now = new Date()): Promise<{ claimed: number; completed: number; failed: number; skipped: number }> {
  const due = await prisma.competitorMonitor.findMany({ where: { enabled: true, nextRunAt: { lte: now }, competitor: { domain: { organizationId: { not: "" } } } }, orderBy: { nextRunAt: "asc" }, take: 50, select: { id: true, organizationId: true, frequencyHours: true } });
  let completed = 0; let failed = 0; let skipped = 0;
  for (const candidate of due) {
    const reservedUntil = new Date(now.getTime() + candidate.frequencyHours * 3600_000);
    const claim = await prisma.competitorMonitor.updateMany({ where: { id: candidate.id, organizationId: candidate.organizationId, enabled: true, nextRunAt: { lte: now } }, data: { nextRunAt: reservedUntil } });
    if (!claim.count) { skipped++; continue; }
    try {
      // The organizationId remains part of every lookup and claim, including monitors belonging to other tenants.
      const monitor = await scopedMonitor(candidate.organizationId, candidate.id);
      await captureMonitor(monitor, now); completed++;
    } catch {
      failed++;
      await prisma.competitorMonitor.updateMany({ where: { id: candidate.id, organizationId: candidate.organizationId }, data: { lastRunAt: now, nextRunAt: new Date(now.getTime() + candidate.frequencyHours * 3600_000) } });
    }
  }
  return { claimed: due.length - skipped, completed, failed, skipped };
}

competitorMonitoringRouter.get("/monitors", wrap(async (req, res) => {
  const query = paging.extend({ projectId: id.optional() }).parse(req.query); const organizationId = req.auth!.organizationId;
  if (query.projectId && !await prisma.project.findFirst({ where: { id: query.projectId, organizationId }, select: { id: true } })) throw notFound();
  const where = { organizationId, ...(query.projectId ? { projectId: query.projectId } : {}) };
  const [total, data] = await Promise.all([prisma.competitorMonitor.count({ where }), prisma.competitorMonitor.findMany({ where, orderBy: { updatedAt: "desc" }, skip: query.offset, take: query.limit, include: { competitor: { include: { domain: { select: { id: true, host: true } } } }, website: { select: { id: true, host: true } }, project: { select: { id: true, name: true } }, _count: { select: { snapshots: true, changes: true } } } })]);
  res.json({ data, pagination: { total, offset: query.offset, limit: query.limit }, coverageNote });
}));

competitorMonitoringRouter.post("/monitors", wrap(async (req, res) => {
  manager(req); const input = monitorInput.parse(req.body); const organizationId = req.auth!.organizationId;
  const [project, website, competitor] = await Promise.all([
    prisma.project.findFirst({ where: { id: input.projectId, organizationId }, select: { id: true } }),
    prisma.domain.findFirst({ where: { id: input.websiteId, organizationId, projectId: input.projectId }, select: { id: true } }),
    prisma.competitor.findFirst({ where: { id: input.competitorId, domain: { organizationId, projectId: input.projectId } }, include: { domain: { select: { id: true, host: true } } } }),
  ]);
  if (!project || !website || !competitor) throw notFound();
  const existing = await prisma.competitorMonitor.findFirst({ where: { organizationId, projectId: input.projectId, websiteId: input.websiteId, competitorId: input.competitorId } });
  const nextRunAt = new Date(Date.now() + input.frequencyHours * 3600_000);
  const data = existing ? await prisma.competitorMonitor.update({ where: { id: existing.id }, data: { enabled: true, frequencyHours: input.frequencyHours, nextRunAt } }) : await prisma.competitorMonitor.create({ data: { organizationId, projectId: input.projectId, websiteId: input.websiteId, competitorId: input.competitorId, frequencyHours: input.frequencyHours, nextRunAt, createdById: req.auth!.userId } });
  res.status(existing ? 200 : 201).json({ data, coverageNote });
}));

competitorMonitoringRouter.patch("/monitors/:id", wrap(async (req, res) => {
  manager(req); const monitorId = id.parse(req.params.id); const current = await scopedMonitor(req.auth!.organizationId, monitorId);
  const input = z.object({ enabled: z.boolean().optional(), frequencyHours: z.number().int().min(24).max(720).optional() }).strict().refine((v) => Object.keys(v).length > 0).parse(req.body);
  const frequencyHours = input.frequencyHours ?? current.frequencyHours;
  const data = await prisma.competitorMonitor.update({ where: { id: monitorId }, data: { ...input, ...(input.frequencyHours ? { nextRunAt: new Date(Date.now() + frequencyHours * 3600_000) } : {}) } });
  res.json({ data, coverageNote });
}));

competitorMonitoringRouter.post("/monitors/:id/run", wrap(async (req, res) => {
  manager(req); const monitorId = id.parse(req.params.id); const monitor = await scopedMonitor(req.auth!.organizationId, monitorId);
  const started = new Date();
  try {
    const result = await captureMonitor(monitor, started);
    res.json({ data: result, coverageNote });
  } catch (error) {
    await prisma.competitorMonitor.update({ where: { id: monitorId }, data: { lastRunAt: started, nextRunAt: new Date(started.getTime() + monitor.frequencyHours * 3600_000) } }).catch(() => undefined);
    throw Object.assign(new Error(`Competitor crawl failed: ${error instanceof Error ? error.message : "unknown crawler error"}`), { status: 502, code: "competitor_crawl_failed" });
  }
}));

competitorMonitoringRouter.get("/changes", wrap(async (req, res) => {
  const query = paging.extend({ projectId: id.optional(), competitorId: id.optional(), status: z.enum(["OPEN", "REVIEWED", "DISMISSED"]).optional() }).parse(req.query); const organizationId = req.auth!.organizationId;
  if (query.projectId && !await prisma.project.findFirst({ where: { id: query.projectId, organizationId }, select: { id: true } })) throw notFound();
  if (query.competitorId && !await prisma.competitor.findFirst({ where: { id: query.competitorId, domain: { organizationId, ...(query.projectId ? { projectId: query.projectId } : {}) } }, select: { id: true } })) throw notFound();
  const where = { competitor: { domain: { organizationId, ...(query.projectId ? { projectId: query.projectId } : {}) } }, ...(query.competitorId ? { competitorId: query.competitorId } : {}), ...(query.projectId ? { monitor: { projectId: query.projectId } } : {}), ...(query.status ? { status: query.status } : {}) };
  const [total, data] = await Promise.all([prisma.competitorChangeEvent.count({ where }), prisma.competitorChangeEvent.findMany({ where, orderBy: { createdAt: "desc" }, skip: query.offset, take: query.limit, include: { competitor: { select: { id: true, host: true, label: true } }, monitor: { select: { id: true, projectId: true, lastRunAt: true, frequencyHours: true } }, beforeSnapshot: true, afterSnapshot: true } })]);
  res.json({ data, pagination: { total, offset: query.offset, limit: query.limit }, coverageNote });
}));

competitorMonitoringRouter.patch("/changes/:id/decision", wrap(async (req, res) => {
  manager(req); const eventId = id.parse(req.params.id); const event = await prisma.competitorChangeEvent.findFirst({ where: { id: eventId, competitor: { domain: { organizationId: req.auth!.organizationId } } } }); if (!event) throw notFound();
  const input = z.object({ decision: z.enum(["REVIEWED", "DISMISSED"]), note: z.string().trim().max(2000).optional() }).strict().parse(req.body);
  const oldEvidence = event.evidence && typeof event.evidence === "object" && !Array.isArray(event.evidence) ? event.evidence as Record<string, unknown> : {};
  const data = await prisma.competitorChangeEvent.update({ where: { id: eventId }, data: { status: input.decision, evidence: { ...oldEvidence, review: { decision: input.decision, note: input.note ?? null, reviewedById: req.auth!.userId, reviewedAt: new Date().toISOString() } } as Prisma.InputJsonValue } });
  res.json({ data });
}));

competitorMonitoringRouter.post("/changes/:id/task", wrap(async (req, res) => {
  manager(req); const eventId = id.parse(req.params.id); const org = req.auth!.organizationId;
  const event = await prisma.competitorChangeEvent.findFirst({ where: { id: eventId, competitor: { domain: { organizationId: org } } }, include: { competitor: { include: { domain: { select: { id: true, host: true, projectId: true } } } }, monitor: { select: { projectId: true, websiteId: true } }, beforeSnapshot: true, afterSnapshot: true } });
  if (!event) throw notFound();
  if (event.status !== "REVIEWED") throw Object.assign(new Error("Mark this competitor change reviewed before creating a task."), { status: 409, code: "review_required" });
  const dedupeKey = `COMPETITOR_CHANGE:${event.id}:SEO_TASK`;
  const existing = await prisma.seoTask.findFirst({ where: { organizationId: org, dedupeKey } });
  if (existing) { res.json({ data: existing, idempotent: true }); return; }
  const fields = event.changeType.split("_").filter(Boolean);
  const affectedUrl = event.afterSnapshot?.url ?? event.beforeSnapshot?.url;
  const data = await prisma.seoTask.create({ data: { organizationId: org, projectId: event.monitor.projectId, websiteId: event.monitor.websiteId, title: `Review ${event.competitor.host} change: ${event.changeType}`.slice(0, 200), description: `Assess the observed competitor page change and its relevance to this project. Do not copy competitor content; validate the opportunity against our search intent and existing pages.`, category: "SEO_STRATEGY", priority: event.risk === "HIGH" ? "P2" : "P3", severity: event.risk === "HIGH" ? "HIGH" : "MEDIUM", status: "TODO", sourceModule: "COMPETITOR_MONITORING", sourceEntityType: "CompetitorChangeEvent", sourceEntityId: event.id, sourceEvidence: { competitorHost: event.competitor.host, competitorUrl: affectedUrl, changeType: event.changeType, risk: event.risk, fields, before: event.beforeSnapshot ? { title: event.beforeSnapshot.title, description: event.beforeSnapshot.description, h1: event.beforeSnapshot.h1, canonical: event.beforeSnapshot.canonical, statusCode: event.beforeSnapshot.statusCode } : null, after: event.afterSnapshot ? { title: event.afterSnapshot.title, description: event.afterSnapshot.description, h1: event.afterSnapshot.h1, canonical: event.afterSnapshot.canonical, statusCode: event.afterSnapshot.statusCode } : null, evidence: event.evidence, observedAt: event.createdAt }, affectedUrls: affectedUrl ? [affectedUrl] : [], labels: ["competitor-change", event.risk.toLowerCase()], acceptanceCriteria: ["Validate whether this change creates a relevant opportunity for our website.", "Record supporting keyword or content evidence before recommending implementation."], createdById: req.auth!.userId, dedupeKey } });
  await prisma.seoTaskActivity.create({ data: { taskId: data.id, actorId: req.auth!.userId, action: "TASK_CREATED_FROM_COMPETITOR_CHANGE", metadata: { eventId: event.id } } });
  res.status(201).json({ data, idempotent: false });
}));
