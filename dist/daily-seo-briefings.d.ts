export declare function generateDailySeoBriefing(organizationId: string, projectId: string): Promise<{
    project: {
        name: string;
        id: string;
    };
} & {
    id: string;
    organizationId: string;
    projectId: string;
    briefDate: Date;
    generatedAt: Date;
    data: import("@prisma/client/runtime/library").JsonValue;
}>;
export declare const dailySeoBriefingRouter: import("express-serve-static-core").Router;
export declare function runDueDailySeoBriefings(now?: Date): Promise<void>;
