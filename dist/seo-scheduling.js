import { randomUUID } from "node:crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db.js";
import { requireAuth } from "./auth.js";
import { generateDailySeoBriefing } from "./daily-seo-briefings.js";
import { executeSiteAuditCrawl } from "./site-audit-jobs.js";
import { nextSeoOccurrence, scheduleOccurrenceKey, seoOccurrencesBetween } from "./seo-scheduling-core.js";
export const seoSchedulingRouter = Router();
seoSchedulingRouter.use(requireAuth);
const managers = ["OWNER", "ADMIN", "MANAGER"];
const id = z.string().min(1).max(191);
const recurrenceSchema = z.discriminatedUnion("frequency", [
    z.object({ frequency: z.literal("ONCE"), at: z.string().datetime() }).strict(),
    z.object({ frequency: z.literal("DAILY"), hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59), startAt: z.string().datetime().optional(), endAt: z.string().datetime().optional() }).strict(),
    z.object({ frequency: z.literal("WEEKLY"), hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59), weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7), startAt: z.string().datetime().optional(), endAt: z.string().datetime().optional() }).strict(),
    z.object({ frequency: z.literal("MONTHLY"), hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59), dayOfMonth: z.number().int().min(1).max(28), startAt: z.string().datetime().optional(), endAt: z.string().datetime().optional() }).strict(),
]);
const scheduleSchema = z.object({ projectId: id.nullable().optional(), websiteId: id.nullable().optional(), type: z.enum(["DAILY_SEO_BRIEFING", "SITE_AUDIT"]), title: z.string().trim().min(2).max(240), timezone: z.string().min(1).max(80).default("UTC"), recurrence: recurrenceSchema, payload: z.object({ maxPages: z.number().int().min(1).max(250).optional() }).strict().optional() }).strict();
function fail(status, code, message) { return Object.assign(new Error(message), { status, code }); }
function manager(req) { if (!managers.includes(req.auth.role))
    throw fail(403, "schedule_manager_required", "A workspace manager must manage SEO schedules."); }
function handle(error, res, next) { if (error instanceof z.ZodError) {
    res.status(400).json({ error: { code: "validation_error", message: "Check the submitted fields.", fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) } });
    return;
} if (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
    const e = error;
    res.status(e.status).json({ error: { code: e.code ?? "schedule_error", message: e.message ?? "The request could not be completed." } });
    return;
} next(error); }
const wrap = (fn) => (req, res, next) => { void fn(req, res).catch((error) => handle(error, res, next)); };
seoSchedulingRouter.get("/schedules", wrap(async (req, res) => {
    const query = z.object({ projectId: id.optional(), offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
    const where = { organizationId: req.auth.organizationId, ...(query.projectId ? { projectId: query.projectId } : {}) };
    const [total, data] = await Promise.all([prisma.seoSchedule.count({ where }), prisma.seoSchedule.findMany({ where, orderBy: [{ nextRunAt: "asc" }, { createdAt: "desc" }], skip: query.offset, take: query.limit, include: { project: { select: { id: true, name: true } }, website: { select: { id: true, host: true } } } })]);
    res.json({ data, pagination: { total, offset: query.offset, limit: query.limit } });
}));
seoSchedulingRouter.get("/calendar", wrap(async (req, res) => {
    const query = z.object({ from: z.string().datetime(), to: z.string().datetime(), projectId: id.optional() }).parse(req.query);
    const from = new Date(query.from);
    const to = new Date(query.to);
    const organizationId = req.auth.organizationId;
    if (from > to || to.getTime() - from.getTime() > 93 * 86_400_000)
        throw fail(400, "invalid_calendar_range", "Choose a calendar range of up to 93 days.");
    if (query.projectId && !await prisma.project.findFirst({ where: { id: query.projectId, organizationId }, select: { id: true } }))
        throw fail(404, "project_not_found", "Project was not found in this workspace.");
    const schedules = await prisma.seoSchedule.findMany({ where: { organizationId, enabled: true, ...(query.projectId ? { projectId: query.projectId } : {}) }, orderBy: { nextRunAt: "asc" }, include: { project: { select: { id: true, name: true } }, website: { select: { id: true, host: true } } } });
    const events = schedules.flatMap((schedule) => seoOccurrencesBetween(from, to, schedule.timezone, schedule.recurrence).map((scheduledAt) => ({ id: scheduleOccurrenceKey(schedule.id, scheduledAt), scheduleId: schedule.id, title: schedule.title, type: schedule.type, scheduledAt, timezone: schedule.timezone, project: schedule.project, website: schedule.website }))).sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
    res.json({ data: events, range: { from, to }, note: "Recurring events are calculated in each schedule's configured timezone; paused schedules are excluded." });
}));
seoSchedulingRouter.post("/schedules", wrap(async (req, res) => {
    manager(req);
    const input = scheduleSchema.parse(req.body);
    const organizationId = req.auth.organizationId;
    try {
        new Intl.DateTimeFormat("en", { timeZone: input.timezone });
    }
    catch {
        throw fail(400, "invalid_timezone", "Choose a valid IANA timezone.");
    }
    if (input.type === "DAILY_SEO_BRIEFING" && !input.projectId)
        throw fail(400, "project_required", "A project is required for a scheduled briefing.");
    if (input.projectId && !await prisma.project.findFirst({ where: { id: input.projectId, organizationId }, select: { id: true } }))
        throw fail(404, "project_not_found", "Project was not found in this workspace.");
    if (input.websiteId && !await prisma.domain.findFirst({ where: { id: input.websiteId, organizationId, ...(input.projectId ? { projectId: input.projectId } : {}) }, select: { id: true } }))
        throw fail(404, "website_not_found", "Website was not found in this workspace.");
    const recurrence = input.recurrence;
    const first = nextSeoOccurrence(new Date(Date.now() - 60_000), input.timezone, recurrence);
    if (!first)
        throw fail(400, "no_future_occurrence", "Choose a schedule occurrence in the future.");
    const data = await prisma.seoSchedule.create({ data: { organizationId, projectId: input.projectId ?? null, websiteId: input.websiteId ?? null, type: input.type, title: input.title, timezone: input.timezone, recurrence: recurrence, payload: (input.payload ?? {}), nextRunAt: first, createdById: req.auth.userId } });
    await prisma.activityLog.create({ data: { organizationId, userId: req.auth.userId, action: "seo_schedule.created", entityType: "SeoSchedule", entityId: data.id, metadata: { type: data.type, projectId: data.projectId, nextRunAt: first } } });
    res.status(201).json({ data });
}));
seoSchedulingRouter.patch("/schedules/:id", wrap(async (req, res) => {
    manager(req);
    const scheduleId = id.parse(req.params.id);
    const org = req.auth.organizationId;
    const current = await prisma.seoSchedule.findFirst({ where: { id: scheduleId, organizationId: org } });
    if (!current)
        throw fail(404, "schedule_not_found", "Schedule was not found in this workspace.");
    const patch = z.object({ enabled: z.boolean().optional(), title: z.string().trim().min(2).max(240).optional(), timezone: z.string().min(1).max(80).optional(), recurrence: recurrenceSchema.optional() }).strict().refine((value) => Object.keys(value).length > 0).parse(req.body);
    const timezone = patch.timezone ?? current.timezone;
    try {
        new Intl.DateTimeFormat("en", { timeZone: timezone });
    }
    catch {
        throw fail(400, "invalid_timezone", "Choose a valid IANA timezone.");
    }
    const recurrence = patch.recurrence;
    const nextRunAt = recurrence ? nextSeoOccurrence(new Date(), timezone, recurrence) : patch.enabled === true && current.nextRunAt == null ? nextSeoOccurrence(new Date(), timezone, current.recurrence) : current.nextRunAt;
    const data = await prisma.seoSchedule.update({ where: { id: scheduleId }, data: { ...patch, ...(recurrence ? { recurrence: recurrence } : {}), timezone, nextRunAt: patch.enabled === false ? null : nextRunAt } });
    res.json({ data });
}));
seoSchedulingRouter.get("/schedules/:id/executions", wrap(async (req, res) => {
    const scheduleId = id.parse(req.params.id);
    const query = z.object({ offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
    const org = req.auth.organizationId;
    if (!await prisma.seoSchedule.findFirst({ where: { id: scheduleId, organizationId: org }, select: { id: true } }))
        throw fail(404, "schedule_not_found", "Schedule was not found in this workspace.");
    const where = { scheduleId, organizationId: org };
    const [total, data] = await Promise.all([prisma.seoScheduleExecution.count({ where }), prisma.seoScheduleExecution.findMany({ where, orderBy: { scheduledAt: "desc" }, skip: query.offset, take: query.limit })]);
    res.json({ data, pagination: { total, offset: query.offset, limit: query.limit } });
}));
export async function runDueSeoSchedules(now = new Date()) {
    const due = await prisma.seoSchedule.findMany({ where: { enabled: true, nextRunAt: { lte: now } }, orderBy: { nextRunAt: "asc" }, take: 20 });
    for (const schedule of due) {
        const scheduledAt = schedule.nextRunAt;
        const key = scheduleOccurrenceKey(schedule.id, scheduledAt);
        const next = nextSeoOccurrence(scheduledAt, schedule.timezone, schedule.recurrence);
        try {
            await prisma.$transaction(async (tx) => {
                const execution = await tx.seoScheduleExecution.create({ data: { organizationId: schedule.organizationId, scheduleId: schedule.id, occurrenceKey: key, scheduledAt, status: "QUEUED" } });
                await tx.backgroundJob.create({ data: { organizationId: schedule.organizationId, type: "SEO_SCHEDULE_EXECUTION", payload: { executionId: execution.id }, dedupeKey: key, runAt: scheduledAt } });
                const claimed = await tx.seoSchedule.updateMany({ where: { id: schedule.id, enabled: true, nextRunAt: scheduledAt }, data: { lastRunAt: scheduledAt, nextRunAt: next } });
                if (!claimed.count)
                    throw new Error("Schedule occurrence was claimed by another worker.");
            });
        }
        catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
                continue;
            if (!(error instanceof Error && error.message.includes("claimed by another worker")))
                console.error("Could not enqueue SEO schedule", error instanceof Error ? error.message : "unknown");
        }
    }
}
const workerId = randomUUID();
async function executeSchedule(executionId) {
    const execution = await prisma.seoScheduleExecution.findFirst({ where: { id: executionId }, include: { schedule: true } });
    if (!execution || execution.status === "COMPLETED")
        return { duplicate: true };
    const schedule = execution.schedule;
    if (schedule.type === "DAILY_SEO_BRIEFING") {
        if (!schedule.projectId)
            throw new Error("Project was removed; briefing cannot run.");
        const result = await generateDailySeoBriefing(schedule.organizationId, schedule.projectId);
        return { briefing: result };
    }
    if (schedule.type === "SITE_AUDIT") {
        const domain = schedule.websiteId ? await prisma.domain.findFirst({ where: { id: schedule.websiteId, organizationId: schedule.organizationId, ...(schedule.projectId ? { projectId: schedule.projectId } : {}) }, select: { id: true, host: true } }) : schedule.projectId ? await prisma.domain.findFirst({ where: { projectId: schedule.projectId, organizationId: schedule.organizationId, isPrimary: true }, select: { id: true, host: true } }) : null;
        if (!domain)
            throw new Error("Website no longer exists in this workspace.");
        const payload = schedule.payload && typeof schedule.payload === "object" ? schedule.payload : {};
        const maxPages = Math.max(1, Math.min(250, payload.maxPages ?? 10));
        const savedResult = execution.result && typeof execution.result === "object" && !Array.isArray(execution.result) ? execution.result : {};
        let crawlId = typeof savedResult.crawlId === "string" ? savedResult.crawlId : null;
        if (!crawlId) {
            const crawl = await prisma.$transaction(async (tx) => {
                const created = await tx.crawl.create({
                    data: {
                        domainId: domain.id,
                        status: "queued",
                        configuration: { maxPages, concurrency: 5, source: "seo_schedule", protocol: "https", respectsRobotsTxt: true, javascriptRendered: true, browserRequestsPerPage: 30, maxResponseBytes: 2097152, requestTimeoutMs: 3500 },
                    },
                });
                await tx.seoScheduleExecution.update({ where: { id: execution.id }, data: { result: { crawlId: created.id } } });
                return created;
            });
            crawlId = crawl.id;
        }
        return await executeSiteAuditCrawl(crawlId);
    }
    throw new Error(`Unsupported scheduled operation: ${schedule.type}`);
}
export async function processSeoBackgroundJobs(now = new Date(), limit = 5) {
    for (let index = 0; index < limit; index += 1) {
        const job = await prisma.backgroundJob.findFirst({ where: { runAt: { lte: now }, OR: [{ status: "PENDING" }, { status: "RUNNING", leaseExpiresAt: { lte: now } }] }, orderBy: { runAt: "asc" } });
        if (!job)
            return;
        const eligible = job.status === "PENDING" ? { id: job.id, status: "PENDING" } : { id: job.id, status: "RUNNING", leaseExpiresAt: { lte: now } };
        const claimed = await prisma.backgroundJob.updateMany({ where: eligible, data: { status: "RUNNING", attempts: { increment: 1 }, lockedAt: now, leaseExpiresAt: new Date(now.getTime() + 15 * 60_000), lockedBy: workerId } });
        if (!claimed.count)
            continue;
        const current = await prisma.backgroundJob.findUnique({ where: { id: job.id } });
        if (!current)
            continue;
        const payload = current.payload && typeof current.payload === "object" && !Array.isArray(current.payload) ? current.payload : {};
        const executionId = typeof payload.executionId === "string" ? payload.executionId : null;
        let crawlId = current.type === "SITE_AUDIT_EXECUTION" && typeof payload.crawlId === "string" ? payload.crawlId : null;
        const heartbeat = setInterval(() => {
            void prisma.backgroundJob.updateMany({
                where: { id: current.id, status: "RUNNING", lockedBy: workerId },
                data: { leaseExpiresAt: new Date(Date.now() + 15 * 60_000) },
            }).catch((error) => console.error("Could not renew SEO background job lease", error instanceof Error ? error.message : "unknown error"));
        }, 60_000);
        heartbeat.unref();
        try {
            let result;
            if (current.type === "SEO_SCHEDULE_EXECUTION" && executionId) {
                await prisma.seoScheduleExecution.updateMany({ where: { id: executionId, status: { in: ["QUEUED", "RUNNING", "RETRYING"] } }, data: { status: "RUNNING", startedAt: now, attempt: { increment: 1 } } });
                result = await executeSchedule(executionId);
            }
            else if (current.type === "SITE_AUDIT_EXECUTION" && crawlId) {
                result = await executeSiteAuditCrawl(crawlId);
            }
            else {
                throw new Error(`Unknown or malformed SEO background job "${current.type}".`);
            }
            await prisma.$transaction(async (tx) => {
                if (executionId && current.type === "SEO_SCHEDULE_EXECUTION") {
                    await tx.seoScheduleExecution.updateMany({
                        where: { id: executionId, status: { not: "COMPLETED" } },
                        data: { status: "COMPLETED", finishedAt: new Date(), result: result, error: null },
                    });
                }
                const finalized = await tx.backgroundJob.updateMany({
                    where: { id: current.id, status: "RUNNING", lockedBy: workerId },
                    data: { status: "COMPLETED", finishedAt: new Date(), lockedAt: null, leaseExpiresAt: null, lockedBy: null, error: null },
                });
                if (!finalized.count)
                    throw new Error("Background job lease was lost before completion.");
            });
        }
        catch (error) {
            const message = (error instanceof Error ? error.message : "Scheduled task failed.").slice(0, 2000);
            const exhausted = current.attempts >= current.maxAttempts;
            const retryAt = new Date(now.getTime() + Math.min(60, 2 ** Math.max(0, current.attempts - 1)) * 60_000);
            await prisma.$transaction(async (tx) => {
                const released = await tx.backgroundJob.updateMany({
                    where: { id: current.id, status: "RUNNING", lockedBy: workerId },
                    data: { status: exhausted ? "FAILED" : "PENDING", runAt: retryAt, error: message, finishedAt: exhausted ? new Date() : null, lockedAt: null, leaseExpiresAt: null, lockedBy: null },
                });
                if (!released.count)
                    return;
                if (executionId && current.type === "SEO_SCHEDULE_EXECUTION") {
                    await tx.seoScheduleExecution.updateMany({
                        where: { id: executionId, status: { not: "COMPLETED" } },
                        data: { status: exhausted ? "FAILED" : "RETRYING", error: message, finishedAt: exhausted ? new Date() : null },
                    });
                }
                if (crawlId) {
                    const crawl = await tx.crawl.findUnique({ where: { id: crawlId }, select: { configuration: true } });
                    const crawlConfiguration = crawl?.configuration && typeof crawl.configuration === "object" && !Array.isArray(crawl.configuration)
                        ? crawl.configuration
                        : {};
                    await tx.crawl.updateMany({
                        where: { id: crawlId, status: { in: ["queued", "running"] } },
                        data: {
                            status: exhausted ? "failed" : "queued",
                            finishedAt: exhausted ? new Date() : null,
                            configuration: { ...crawlConfiguration, lastError: message },
                        },
                    });
                }
                await tx.activityLog.create({
                    data: {
                        organizationId: current.organizationId,
                        action: current.type === "SEO_SCHEDULE_EXECUTION" ? "seo_schedule.execution_failed" : "site_audit.execution_failed",
                        entityType: current.type === "SITE_AUDIT_EXECUTION" ? "Crawl" : "BackgroundJob",
                        entityId: crawlId ?? current.id,
                        metadata: { jobType: current.type, attempts: current.attempts, exhausted, message, retryAt },
                    },
                });
            });
        }
        finally {
            clearInterval(heartbeat);
        }
    }
}
