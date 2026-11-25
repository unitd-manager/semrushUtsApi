export type SiteAuditProgress = {
    pagesConsidered: number;
    pagesCrawled: number;
    issueCount: number;
};
export declare function executeSiteAuditCrawl(crawlId: string): Promise<{
    crawlId: string;
    pagesCrawled: number;
    pagesConsidered: number;
    issueCount: number;
    healthScore: number;
}>;
