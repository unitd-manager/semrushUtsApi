import { z } from "zod";
export declare const clientReportSectionKeys: readonly ["executive_summary", "performance_analysis", "seo_overview", "gsc", "ga4", "rankings", "landing_pages", "technical_audit", "daily_briefing", "backlinks", "competitors", "completed_work", "outstanding_issues", "opportunities", "next_period_strategy", "client_commentary", "contact"];
export declare const clientReportFrequencies: readonly ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"];
export type ReportFrequency = typeof clientReportFrequencies[number];
export declare const reportCommentarySchema: z.ZodObject<{
    executiveSummary: z.ZodString;
    performance: z.ZodArray<z.ZodObject<{
        title: z.ZodString;
        detail: z.ZodString;
        evidence: z.ZodArray<z.ZodString>;
        confidence: z.ZodEnum<{
            LOW: "LOW";
            HIGH: "HIGH";
            MEDIUM: "MEDIUM";
        }>;
    }, z.core.$strict>>;
    nextPeriodPriorities: z.ZodArray<z.ZodObject<{
        title: z.ZodString;
        reason: z.ZodString;
        evidence: z.ZodArray<z.ZodString>;
        confidence: z.ZodEnum<{
            LOW: "LOW";
            HIGH: "HIGH";
            MEDIUM: "MEDIUM";
        }>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const defaultReportSections: {
    sectionKey: "contact" | "backlinks" | "competitors" | "rankings" | "executive_summary" | "performance_analysis" | "seo_overview" | "gsc" | "ga4" | "landing_pages" | "technical_audit" | "daily_briefing" | "completed_work" | "outstanding_issues" | "opportunities" | "next_period_strategy" | "client_commentary";
    title: string;
    position: number;
    enabled: boolean;
}[];
export type MetricComparison = {
    current: number | null;
    previous: number | null;
    difference: number | null;
    percentChange: number | null;
    direction: "up" | "down" | "flat" | "unavailable";
};
export declare function compareMetric(current: number | null | undefined, previous: number | null | undefined): MetricComparison;
export declare function nextReportScheduleAt(now: Date, frequency: ReportFrequency, scheduleDay: number, hour: number, minute: number, timezone: string, scheduleMonth?: number): Date;
export declare function previousCompletedPeriod(now: Date, frequency: ReportFrequency, timezone: string): {
    start: Date;
    end: Date;
};
export declare function renderClientReportPdf(input: {
    snapshot: Record<string, any>;
    commentary: Record<string, any>;
    manualNotes: string | null;
    client: {
        name: string;
    };
    title: string;
    period: string;
    branding: Record<string, any>;
}): Uint8Array;
