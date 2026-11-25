export type RankingCountry = "US" | "GB" | "CA" | "AU" | "IN";
export type RankingDevice = "desktop" | "mobile";
export type RankingObservation = {
    keyword: string;
    position: number | null;
    url: string | null;
    observedAt: string;
};
export type RankingResult = {
    provider: "dataforseo";
    confidence: "PROVIDER_OBSERVED";
    billedCostUsd: number | null;
    observations: RankingObservation[];
};
export declare class DataForSeoRankingProvider {
    private readonly config;
    private readonly request;
    readonly id: "dataforseo";
    constructor(config: {
        login?: string;
        password?: string;
        enabled: boolean;
    }, request?: typeof fetch);
    check(input: {
        keywords: string[];
        country: RankingCountry;
        device: RankingDevice;
        targetHost: string;
        depth?: 10 | 100;
    }): Promise<RankingResult>;
}
export declare function configuredDataForSeoRankingProvider(request?: typeof fetch, overrides?: {
    login?: string;
    password?: string;
    enabled?: boolean;
}): DataForSeoRankingProvider;
