import { Prisma, type PrismaClient } from "@prisma/client";
export declare const reportSectionNames: readonly ["site_audit", "rankings", "backlinks", "keyword_metrics", "competitors", "content", "traffic_estimates"];
export type ReportSectionName = typeof reportSectionNames[number];
export type ReportSnapshotInput = {
    projectId: string;
    sections: ReportSectionName[];
    country: "US" | "GB" | "CA" | "AU" | "IN";
    device: "desktop" | "mobile";
};
type ReportDb = PrismaClient | Prisma.TransactionClient;
type ReportSection = {
    status: string;
    source: string;
    confidence: string;
    observedAt: string | null;
    note: string;
    rows: unknown[];
    summary?: Record<string, unknown> | null;
    history?: unknown[];
    pages?: unknown[];
    truncated?: boolean;
};
export declare function buildReportSnapshot(db: ReportDb, organizationId: string, input: ReportSnapshotInput): Promise<{
    generatedAt: string;
    project: {
        id: string;
        domain: string;
    };
    market: "US" | "GB" | "CA" | "AU" | "IN";
    device: "desktop" | "mobile";
    sections: Record<string, ReportSection>;
} | null>;
export {};
