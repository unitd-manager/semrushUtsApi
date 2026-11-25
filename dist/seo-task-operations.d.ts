export declare const seoTaskStatuses: readonly ["BACKLOG", "TODO", "ASSIGNED", "IN_PROGRESS", "BLOCKED", "READY_FOR_REVIEW", "CHANGES_REQUESTED", "APPROVED", "COMPLETED", "VERIFICATION_PENDING", "VERIFIED", "REOPENED", "CANCELLED"];
export declare const seoTaskPriorities: readonly ["P0", "P1", "P2", "P3"];
export declare const seoTaskCategories: readonly ["TECHNICAL_SEO", "ON_PAGE_SEO", "OFF_PAGE_SEO", "KEYWORD_RESEARCH", "CONTENT_CREATION", "CONTENT_OPTIMIZATION", "INTERNAL_LINKING", "LINK_BUILDING", "LOCAL_SEO", "WEBSITE_PERFORMANCE", "INDEXING_CRAWLING", "SCHEMA_STRUCTURED_DATA", "COMPETITOR_ANALYSIS", "CONVERSION_OPTIMIZATION", "SEO_STRATEGY", "CUSTOM"];
export declare function canTransitionTask(from: string, to: string): boolean;
export declare function recommendSeoTaskPriority(input: {
    severity?: string | null;
    affectedUrlCount?: number;
    category?: string | null;
}): "P0" | "P1" | "P2" | "P3";
export declare function dependencyWouldCycle(taskId: string, dependsOnTaskId: string, edges: {
    taskId: string;
    dependsOnTaskId: string;
}[]): boolean;
export declare function isTaskOverdue(task: {
    dueDate: Date | null;
    status: string;
}, now?: Date): boolean;
