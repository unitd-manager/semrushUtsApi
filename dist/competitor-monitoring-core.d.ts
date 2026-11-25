export type PageState = {
    statusCode: number | null;
    title: string | null;
    description: string | null;
    h1: string | null;
    canonical: string | null;
    robots: string | null;
    contentDigest: string | null;
};
declare const trackedFields: readonly ["statusCode", "title", "description", "h1", "canonical", "robots", "contentDigest"];
export type TrackedField = typeof trackedFields[number];
export declare function changedPageFields(before: PageState | null, after: PageState): TrackedField[];
export declare function changeRisk(fields: TrackedField[], before: PageState | null, after: PageState): "HIGH" | "MEDIUM" | "LOW";
export declare function eventDedupeKey(monitorId: string, url: string, beforeSnapshotId: string, changedFields: TrackedField[], after: PageState): string;
export {};
