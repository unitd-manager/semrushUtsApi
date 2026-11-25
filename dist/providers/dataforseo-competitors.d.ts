import type { RankingCountry } from "./dataforseo-rankings.js";
export type CompetitorEstimate = {
    host: string;
    averagePosition: number | null;
    intersections: number | null;
    organicKeywords: number | null;
    estimatedOrganicTraffic: number | null;
    paidKeywords: number | null;
    estimatedPaidTraffic: number | null;
    estimatedPaidTrafficCost: number | null;
};
export type CompetitorGapKeyword = {
    keyword: string;
    searchVolume: number | null;
    cpc: number | null;
    competition: number | null;
    competitorPosition: number | null;
    competitorUrl: string | null;
};
export type CompetitorProviderResult<T> = {
    provider: "dataforseo_labs_competitors_domain" | "dataforseo_labs_domain_intersection";
    confidence: "PROVIDER_ESTIMATE";
    observedAt: string;
    billedCostUsd: number | null;
    totalCount: number;
    items: T[];
};
export declare class DataForSeoCompetitorProvider {
    private readonly config;
    private readonly request;
    readonly id: "dataforseo_labs_competitors";
    constructor(config: {
        login?: string;
        password?: string;
        enabled: boolean;
    }, request?: typeof fetch);
    discover(input: {
        target: string;
        country: RankingCountry;
        limit: number;
    }): Promise<CompetitorProviderResult<CompetitorEstimate>>;
    keywordGap(input: {
        target: string;
        competitor: string;
        country: RankingCountry;
        limit: number;
        offset: number;
    }): Promise<CompetitorProviderResult<CompetitorGapKeyword>>;
    private lastCost;
    private post;
}
export declare function configuredDataForSeoCompetitorProvider(request?: typeof fetch, overrides?: {
    login?: string;
    password?: string;
    enabled?: boolean;
}): DataForSeoCompetitorProvider;
