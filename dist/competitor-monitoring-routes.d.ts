export declare const competitorMonitoringRouter: import("express-serve-static-core").Router;
/** Run due monitors once per invocation; nextRunAt is advanced atomically before crawling to exclude competing workers. */
export declare function runDueCompetitorMonitors(now?: Date): Promise<{
    claimed: number;
    completed: number;
    failed: number;
    skipped: number;
}>;
