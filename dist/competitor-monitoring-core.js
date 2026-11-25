import { createHash } from "node:crypto";
const trackedFields = ["statusCode", "title", "description", "h1", "canonical", "robots", "contentDigest"];
export function changedPageFields(before, after) {
    if (!before)
        return [];
    return trackedFields.filter((field) => (before[field] ?? null) !== (after[field] ?? null));
}
export function changeRisk(fields, before, after) {
    if (fields.some((field) => field === "statusCode" && before?.statusCode != null && before.statusCode < 400 && after.statusCode != null && after.statusCode >= 400))
        return "HIGH";
    if (fields.some((field) => ["canonical", "robots"].includes(field)))
        return "HIGH";
    if (fields.some((field) => ["title", "description", "h1", "contentDigest"].includes(field)))
        return "MEDIUM";
    return "LOW";
}
export function eventDedupeKey(monitorId, url, beforeSnapshotId, changedFields, after) {
    const digest = createHash("sha256").update(JSON.stringify([monitorId, url, beforeSnapshotId, changedFields, after])).digest("hex");
    return `competitor-change:${digest}`;
}
