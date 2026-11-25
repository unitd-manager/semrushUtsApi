import "./load-env.js";
import { randomUUID } from "node:crypto";
import { prisma } from "./db.js";
import { processSeoBackgroundJobs, runDueSeoSchedules } from "./seo-scheduling.js";
import { runDueCompetitorMonitors } from "./competitor-monitoring-routes.js";

const workerId = randomUUID();
let stopping = false;
let running = false;

async function tick() {
  if (running || stopping) return;
  running = true;
  try {
    await runDueSeoSchedules();
    await processSeoBackgroundJobs();
    const result = await runDueCompetitorMonitors();
    if (result.claimed) console.info(`[seo-worker:${workerId}] competitor monitors: ${result.completed} completed, ${result.failed} failed, ${result.skipped} skipped`);
  } catch (error) {
    console.error(`[seo-worker:${workerId}] polling failed`, error instanceof Error ? error.message : "unknown error");
  } finally {
    running = false;
  }
}

const timer = setInterval(() => { void tick(); }, 15_000);
void tick();

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  while (running) await new Promise((resolve) => setTimeout(resolve, 100));
  await prisma.$disconnect();
}

process.once("SIGINT", () => { void shutdown().finally(() => process.exit(0)); });
process.once("SIGTERM", () => { void shutdown().finally(() => process.exit(0)); });
