import { Router } from "express";
import { z } from "zod";
import { prisma } from "./db.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "./auth.js";

type Priority = { title: string; detail: string; severity: string; href: string; source: string };

function nextUtcRun(hour: number, minute: number, from = new Date()): Date {
  const next = new Date(from);
  next.setUTCHours(hour, minute, 0, 0);
  if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function dateSlot(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function buildBrief(organizationId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId }, include: { domains: { where: { isPrimary: true }, take: 1 } } });
  if (!project) throw Object.assign(new Error("Project was not found in this workspace."), { status: 404, code: "project_not_found" });
  const domain = project.domains[0];
  const [crawl, recommendations, tasks, rankings, intelligence, mappings, competitorChanges] = await Promise.all([
    domain ? prisma.crawl.findFirst({ where: { domainId: domain.id, status: "completed" }, orderBy: { startedAt: "desc" }, include: { _count: { select: { issues: true } }, issues: { orderBy: [{ severity: "asc" }, { id: "asc" }], take: 6, select: { code: true, severity: true, message: true, pageUrl: true } } } }) : null,
    prisma.recommendation.findMany({ where: { organizationId, projectId, state: "open" }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, module: true, title: true, description: true, createdAt: true } }),
    prisma.task.findMany({ where: { organizationId, projectId, status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] } }, orderBy: [{ priority: "desc" }, { createdAt: "desc" }], take: 5, select: { title: true, status: true, priority: true } }),
    domain ? prisma.ranking.findMany({ where: { domainId: domain.id }, orderBy: { observedAt: "desc" }, take: 300, select: { keyword: true, position: true, observedAt: true, url: true, confidence: true } }) : [],
    prisma.seoIntelligenceRecord.findMany({ where: { organizationId, projectId, status: { in: ["OPEN", "APPROVED"] }, type: { not: "CALENDAR_ACTIVITY" } }, orderBy: [{ priority: "asc" }, { updatedAt: "desc" }], take: 10, select: { id: true, type: true, title: true, status: true, priority: true, sourceModule: true, createdAt: true } }),
    prisma.keywordPageMapping.findMany({ where: { organizationId, projectId, status: "PENDING_REVIEW" }, orderBy: { updatedAt: "desc" }, take: 5, select: { id: true, phrase: true, pageUrl: true, updatedAt: true } }),
    prisma.competitorChangeEvent.findMany({ where: { competitor: { domain: { organizationId, projectId } }, status: "OPEN", risk: { in: ["HIGH", "MEDIUM"] } }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, risk: true, changeType: true, createdAt: true, afterSnapshot: { select: { url: true } }, competitor: { select: { host: true } } } }),
  ]);
  const latestByKeyword = new Map<string, (typeof rankings)[number]>();
  for (const row of rankings) if (!latestByKeyword.has(row.keyword)) latestByKeyword.set(row.keyword, row);
  const rankingRows = [...latestByKeyword.values()];
  const priorities: Priority[] = [];
  if (!domain) priorities.push({ title: "Add a primary website", detail: "Connect a primary domain to include crawl and ranking evidence in this briefing.", severity: "info", href: "/projects", source: "Project setup" });
  else if (!crawl) priorities.push({ title: "Run a Site Audit", detail: `No completed crawl is saved for ${domain.host} yet.`, severity: "info", href: "/site-audit", source: "Site Audit coverage" });
  if (crawl) {
    const critical = crawl.issues.filter((issue) => issue.severity === "CRITICAL" || issue.severity === "ERROR").length;
    if (critical) priorities.push({ title: `Review ${critical} critical or error audit findings`, detail: crawl.issues.slice(0, 3).map((issue) => issue.message).join(" • ") || `${crawl._count.issues} total issues were recorded in the latest crawl.`, severity: "high", href: "/site-audit", source: "Latest completed crawl" });
    else priorities.push({ title: "Review the latest Site Audit", detail: `${crawl._count.issues} findings across ${crawl.pagesCrawled} crawled pages${crawl.healthScore === null ? "" : `; health score ${crawl.healthScore}/100`}.`, severity: "normal", href: "/site-audit", source: "Latest completed crawl" });
  }
  for (const item of recommendations.slice(0, 4)) priorities.push({ title: item.title, detail: item.description, severity: "normal", href: item.module === "on-page" ? "/on-page" : "/site-audit", source: `${item.module} recommendation` });
  for (const task of tasks.slice(0, 2)) priorities.push({ title: task.title, detail: `Team task is ${task.status.toLowerCase().replace("_", " ")} (${task.priority.toLowerCase()} priority).`, severity: task.priority === "URGENT" || task.priority === "HIGH" ? "high" : "normal", href: "/projects", source: "Workspace task" });
  for (const item of intelligence.slice(0, 4)) priorities.push({ title: item.title, detail: `${item.type.toLocaleLowerCase().replaceAll("_", " ")} finding is ${item.status.toLocaleLowerCase()} (${item.priority.toLocaleLowerCase()} priority). Review its stored evidence before acting.`, severity: item.priority === "CRITICAL" || item.priority === "HIGH" ? "high" : "normal", href: item.type === "INTERNAL_LINK" ? "/internal-link-automation" : item.type === "CONTENT_OPTIMIZATION" ? "/content-optimization-workbench" : item.type === "COMPETITOR_CHANGE" ? "/competitor-change-monitoring" : item.type === "WEBSITE_CHANGE" ? "/website-change-monitor" : "/keyword-page-mapping", source: `SEO Intelligence · ${item.sourceModule ?? item.type}` });
  for (const mapping of mappings.slice(0, 3)) priorities.push({ title: `Review keyword target: ${mapping.phrase}`, detail: `Proposed page ${mapping.pageUrl} is awaiting a mapping decision.`, severity: "normal", href: "/keyword-page-mapping", source: "Keyword-to-Page Mapping" });
  for (const event of competitorChanges.slice(0, 3)) priorities.push({ title: `Competitor ${event.risk.toLowerCase()}-risk change: ${event.competitor.host}`, detail: `${event.changeType.replaceAll("_", " ")} observed on ${event.afterSnapshot?.url ?? "a monitored URL"}. Review the before-and-after snapshots.`, severity: event.risk === "HIGH" ? "high" : "normal", href: "/competitor-change-monitoring", source: "Competitor monitoring" });
  const signals = [
    ...(crawl ? [{ title: `Site health ${crawl.healthScore === null ? "not scored" : `${crawl.healthScore}/100`}`, detail: `${crawl.pagesCrawled} pages crawled; ${crawl._count.issues} saved audit findings.`, source: "First-party crawler", observedAt: crawl.finishedAt?.toISOString() ?? crawl.startedAt.toISOString() }] : []),
    ...(rankingRows.length ? [{ title: `${rankingRows.filter((row) => row.position !== null && row.position <= 10).length} tracked keywords in the top 10`, detail: `${rankingRows.length} latest saved ranking observations${rankingRows[0]?.confidence ? ` (${rankingRows[0].confidence.toLowerCase().replaceAll("_", " ")})` : ""}.`, source: "Saved ranking snapshots", observedAt: rankingRows[0]?.observedAt.toISOString() ?? null }] : []),
    ...(recommendations.length ? [{ title: `${recommendations.length} open SEO recommendations`, detail: "Recommendations are sourced from saved platform workflows.", source: "Recommendation queue", observedAt: recommendations[0]?.createdAt.toISOString() ?? null }] : []),
    ...(intelligence.length ? [{ title: `${intelligence.length} open SEO intelligence findings`, detail: "Saved mapping, content, competitor and website-change records require human review.", source: "SEO Intelligence records", observedAt: intelligence[0]?.createdAt.toISOString() ?? null }] : []),
    ...(mappings.length ? [{ title: `${mappings.length} keyword mappings awaiting review`, detail: "Target URL decisions remain pending until an authorized reviewer approves them.", source: "Keyword-to-Page Mapping", observedAt: mappings[0]?.updatedAt.toISOString() ?? null }] : []),
    ...(competitorChanges.length ? [{ title: `${competitorChanges.length} notable competitor page changes`, detail: "Bounded crawler snapshots show changes requiring specialist review.", source: "Competitor monitoring", observedAt: competitorChanges[0]?.createdAt.toISOString() ?? null }] : []),
  ];
  const metrics = [
    { label: "Site health", value: crawl?.healthScore === null || !crawl ? "—" : `${crawl.healthScore}/100`, detail: crawl ? `Crawl ${crawl.pagesCrawled} pages` : "No completed crawl saved" },
    { label: "Audit findings", value: crawl?._count.issues ?? "—", detail: crawl ? "Latest completed crawl" : "Unavailable" },
    { label: "Top 10 keywords", value: rankingRows.length ? rankingRows.filter((row) => row.position !== null && row.position <= 10).length : "—", detail: rankingRows.length ? `${rankingRows.length} saved observations` : "No saved ranking observations" },
    { label: "Open recommendations", value: recommendations.length, detail: "Across this project" },
  ];
  const headline = priorities[0]?.title ?? "No urgent SEO follow-up found";
  const summary = signals.length ? `${project.name} briefing from saved platform evidence for ${domain?.host ?? "the selected project"}. ${signals.map((signal) => signal.title).join(" · ")}.` : "There is not enough saved SEO evidence to build a detailed briefing yet. Run a Site Audit or save ranking observations to begin.";
  return { project, data: { headline, summary, metrics, priorities: priorities.slice(0, 10), signals, coverage: [crawl ? "First-party Site Audit crawl" : "No completed Site Audit crawl", rankingRows.length ? "Saved provider-observed rankings" : "No saved ranking observations", recommendations.length ? "Saved recommendation queue" : "No open recommendations", "Organic traffic and authority are omitted unless connected source data exists"] } };
}

export async function generateDailySeoBriefing(organizationId: string, projectId: string) {
  const { project, data } = await buildBrief(organizationId, projectId);
  const briefDate = dateSlot();
  const brief = await prisma.dailySeoBriefing.upsert({
    where: { organizationId_projectId_briefDate: { organizationId, projectId, briefDate } },
    create: { organizationId, projectId, briefDate, data },
    update: { generatedAt: new Date(), data },
    include: { project: { select: { id: true, name: true } } },
  });
  return brief;
}

export const dailySeoBriefingRouter = Router();
const projectIdInput = z.object({ projectId: z.string().min(1) });

dailySeoBriefingRouter.get("/", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { projectId } = projectIdInput.parse(req.query);
    const organizationId = req.auth!.organizationId;
    const project = await prisma.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true } });
    if (!project) { res.status(404).json({ error: { code: "project_not_found", message: "Project was not found in this workspace." } }); return; }
    const [settings, data] = await Promise.all([
      prisma.dailySeoBriefingSetting.findUnique({ where: { organizationId_projectId: { organizationId, projectId } } }),
      prisma.dailySeoBriefing.findMany({ where: { organizationId, projectId }, orderBy: { briefDate: "desc" }, take: 14, include: { project: { select: { id: true, name: true } } } }),
    ]);
    res.json({ settings, data });
  } catch (error) { next(error); }
});

dailySeoBriefingRouter.put("/settings", requireAuth, requireRole("OWNER", "ADMIN", "MANAGER"), async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = z.object({ projectId: z.string().min(1), enabled: z.boolean(), hourUtc: z.number().int().min(0).max(23), minuteUtc: z.number().int().min(0).max(59) }).parse(req.body);
    const organizationId = req.auth!.organizationId;
    const project = await prisma.project.findFirst({ where: { id: input.projectId, organizationId }, select: { id: true } });
    if (!project) { res.status(404).json({ error: { code: "project_not_found", message: "Project was not found in this workspace." } }); return; }
    const data = await prisma.dailySeoBriefingSetting.upsert({
      where: { organizationId_projectId: { organizationId, projectId: input.projectId } },
      create: { ...input, organizationId, nextRunAt: input.enabled ? nextUtcRun(input.hourUtc, input.minuteUtc) : null },
      update: { enabled: input.enabled, hourUtc: input.hourUtc, minuteUtc: input.minuteUtc, nextRunAt: input.enabled ? nextUtcRun(input.hourUtc, input.minuteUtc) : null },
    });
    res.json({ data });
  } catch (error) { next(error); }
});

dailySeoBriefingRouter.post("/generate", requireAuth, requireRole("OWNER", "ADMIN", "MANAGER", "ANALYST"), async (req: AuthenticatedRequest, res, next) => {
  try {
    const { projectId } = projectIdInput.parse(req.body);
    const data = await generateDailySeoBriefing(req.auth!.organizationId, projectId);
    res.status(201).json({ data, note: "Briefing generated from saved workspace data. No paid provider request was made." });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) {
      const details = error as { status?: unknown; message?: unknown };
      if (details.status === 404) { res.status(404).json({ error: { code: "project_not_found", message: typeof details.message === "string" ? details.message : "Project was not found in this workspace." } }); return; }
    }
    next(error);
  }
});

export async function runDueDailySeoBriefings(now = new Date()): Promise<void> {
  const due = await prisma.dailySeoBriefingSetting.findMany({ where: { enabled: true, nextRunAt: { lte: now } }, take: 20, orderBy: { nextRunAt: "asc" }, select: { id: true, organizationId: true, projectId: true, hourUtc: true, minuteUtc: true } });
  for (const setting of due) {
    const nextRunAt = nextUtcRun(setting.hourUtc, setting.minuteUtc, now);
    const claimed = await prisma.dailySeoBriefingSetting.updateMany({ where: { id: setting.id, enabled: true, nextRunAt: { lte: now } }, data: { nextRunAt, lastRunAt: now } });
    if (!claimed.count) continue;
    try { await generateDailySeoBriefing(setting.organizationId, setting.projectId); }
    catch (error) { console.error("Daily SEO briefing generation error", error instanceof Error ? error.message : "unknown error"); }
  }
}
