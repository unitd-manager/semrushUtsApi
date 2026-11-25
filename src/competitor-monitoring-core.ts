import { createHash } from "node:crypto";

export type PageState = {
  statusCode: number | null; title: string | null; description: string | null; h1: string | null;
  canonical: string | null; robots: string | null; contentDigest: string | null;
};

const trackedFields = ["statusCode", "title", "description", "h1", "canonical", "robots", "contentDigest"] as const;
export type TrackedField = typeof trackedFields[number];

export function changedPageFields(before: PageState | null, after: PageState): TrackedField[] {
  if (!before) return [];
  return trackedFields.filter((field) => (before[field] ?? null) !== (after[field] ?? null));
}

export function changeRisk(fields: TrackedField[], before: PageState | null, after: PageState): "HIGH" | "MEDIUM" | "LOW" {
  if (fields.some((field) => field === "statusCode" && before?.statusCode != null && before.statusCode < 400 && after.statusCode != null && after.statusCode >= 400)) return "HIGH";
  if (fields.some((field) => ["canonical", "robots"].includes(field))) return "HIGH";
  if (fields.some((field) => ["title", "description", "h1", "contentDigest"].includes(field))) return "MEDIUM";
  return "LOW";
}

export function eventDedupeKey(monitorId: string, url: string, beforeSnapshotId: string, changedFields: TrackedField[], after: PageState): string {
  const digest = createHash("sha256").update(JSON.stringify([monitorId, url, beforeSnapshotId, changedFields, after])).digest("hex");
  return `competitor-change:${digest}`;
}
