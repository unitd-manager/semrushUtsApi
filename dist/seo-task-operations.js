export const seoTaskStatuses = ["BACKLOG", "TODO", "ASSIGNED", "IN_PROGRESS", "BLOCKED", "READY_FOR_REVIEW", "CHANGES_REQUESTED", "APPROVED", "COMPLETED", "VERIFICATION_PENDING", "VERIFIED", "REOPENED", "CANCELLED"];
export const seoTaskPriorities = ["P0", "P1", "P2", "P3"];
export const seoTaskCategories = ["TECHNICAL_SEO", "ON_PAGE_SEO", "OFF_PAGE_SEO", "KEYWORD_RESEARCH", "CONTENT_CREATION", "CONTENT_OPTIMIZATION", "INTERNAL_LINKING", "LINK_BUILDING", "LOCAL_SEO", "WEBSITE_PERFORMANCE", "INDEXING_CRAWLING", "SCHEMA_STRUCTURED_DATA", "COMPETITOR_ANALYSIS", "CONVERSION_OPTIMIZATION", "SEO_STRATEGY", "CUSTOM"];
const transitions = {
    BACKLOG: ["TODO", "CANCELLED"], TODO: ["ASSIGNED", "BACKLOG", "CANCELLED"],
    ASSIGNED: ["IN_PROGRESS", "BLOCKED", "TODO", "CANCELLED"], IN_PROGRESS: ["BLOCKED", "READY_FOR_REVIEW", "CANCELLED"],
    BLOCKED: ["TODO", "ASSIGNED", "IN_PROGRESS", "CANCELLED"], READY_FOR_REVIEW: ["CHANGES_REQUESTED", "APPROVED", "IN_PROGRESS"],
    CHANGES_REQUESTED: ["IN_PROGRESS", "CANCELLED"], APPROVED: ["COMPLETED", "VERIFICATION_PENDING", "IN_PROGRESS"],
    COMPLETED: ["VERIFICATION_PENDING", "REOPENED"], VERIFICATION_PENDING: ["VERIFIED", "REOPENED"],
    VERIFIED: ["REOPENED"], REOPENED: ["ASSIGNED", "IN_PROGRESS", "CANCELLED"], CANCELLED: ["BACKLOG"],
};
export function canTransitionTask(from, to) { return transitions[from]?.includes(to) ?? false; }
export function recommendSeoTaskPriority(input) {
    const severity = (input.severity ?? "").toUpperCase();
    const count = Math.max(0, input.affectedUrlCount ?? 0);
    if (severity === "CRITICAL" && count >= 25)
        return "P0";
    if (severity === "CRITICAL" || (count >= 100 && ["CANONICAL", "INDEXING", "REDIRECT", "BROKEN_LINK"].some((value) => (input.category ?? "").toUpperCase().includes(value))))
        return "P1";
    if (severity === "ERROR" || count >= 10)
        return "P2";
    return "P3";
}
export function dependencyWouldCycle(taskId, dependsOnTaskId, edges) {
    if (taskId === dependsOnTaskId)
        return true;
    const adjacency = new Map();
    for (const edge of edges)
        adjacency.set(edge.taskId, [...(adjacency.get(edge.taskId) ?? []), edge.dependsOnTaskId]);
    const visited = new Set();
    const stack = [dependsOnTaskId];
    while (stack.length) {
        const current = stack.pop();
        if (current === taskId)
            return true;
        if (visited.has(current))
            continue;
        visited.add(current);
        stack.push(...(adjacency.get(current) ?? []));
    }
    return false;
}
export function isTaskOverdue(task, now = new Date()) {
    return Boolean(task.dueDate && task.dueDate.getTime() < now.getTime() && !["COMPLETED", "VERIFIED", "CANCELLED"].includes(task.status));
}
