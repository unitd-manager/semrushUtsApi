import { type PrismaClient } from "@prisma/client";
type WebsiteInput = {
    domainId: string;
    projectId: string;
    host: string;
};
type Period = {
    start: Date;
    end: Date;
};
export declare function collectClientReportData(db: PrismaClient, organizationId: string, websites: WebsiteInput[], current: Period, comparison: Period | null, timezone: string): Promise<{
    generatedAt: string;
    currentPeriod: {
        start: string;
        end: string;
    };
    comparisonPeriod: {
        start: string;
        end: string;
    } | null;
    timezone: string;
    sections: Record<string, any>[];
}>;
export declare function generateEvidenceCommentary(snapshot: Record<string, any>, organizationId: string): Promise<{
    mode: string;
    executiveSummary: string;
    performance: any;
    nextPeriodPriorities: any;
}>;
export declare function completedMonth(now: Date): {
    start: Date;
    end: Date;
};
export declare function previousEquivalentPeriod(period: {
    start: Date;
    end: Date;
}): {
    start: Date;
    end: Date;
};
export {};
