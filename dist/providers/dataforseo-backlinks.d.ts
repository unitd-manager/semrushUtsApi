export type BacklinkSummary = {
    target: string;
    targetRank: number | null;
    backlinks: number | null;
    referringDomains: number | null;
    referringMainDomains: number | null;
    referringIps: number | null;
    referringPages: number | null;
    brokenBacklinks: number | null;
    backlinkSpamScore: number | null;
    targetSpamScore: number | null;
    firstSeen: string | null;
    lostDate: string | null;
    crawledPages: number | null;
};
export type BacklinkSummaryResult = {
    provider: "dataforseo_backlinks";
    confidence: "PROVIDER_OBSERVED";
    observedAt: string;
    billedCostUsd: number | null;
    summary: BacklinkSummary;
};
export type BacklinkItem = {
    sourceUrl: string;
    targetUrl: string;
    anchorText: string | null;
    follow: boolean | null;
    firstSeen: string | null;
    lastSeen: string | null;
    lostAt: string | null;
    pageRank: number | null;
    spamScore: number | null;
    isNew: boolean;
    isLost: boolean;
};
export type BacklinkListResult = {
    provider: "dataforseo_backlinks";
    confidence: "PROVIDER_OBSERVED";
    observedAt: string;
    billedCostUsd: number | null;
    totalCount: number;
    items: BacklinkItem[];
};
export declare class DataForSeoBacklinkProvider {
    private readonly config;
    private readonly request;
    readonly id: "dataforseo_backlinks";
    constructor(config: {
        login?: string;
        password?: string;
        enabled: boolean;
    }, request?: typeof fetch);
    summarize(target: string): Promise<BacklinkSummaryResult>;
    list(input: {
        target: string;
        limit: number;
        offset: number;
        status: "all" | "live" | "lost";
    }): Promise<BacklinkListResult>;
}
export declare function configuredDataForSeoBacklinkProvider(request?: typeof fetch, overrides?: {
    login?: string;
    password?: string;
    enabled?: boolean;
}): DataForSeoBacklinkProvider;
