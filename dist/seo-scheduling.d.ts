export declare const seoSchedulingRouter: import("express-serve-static-core").Router;
export declare function runDueSeoSchedules(now?: Date): Promise<void>;
export declare function processSeoBackgroundJobs(now?: Date, limit?: number): Promise<void>;
