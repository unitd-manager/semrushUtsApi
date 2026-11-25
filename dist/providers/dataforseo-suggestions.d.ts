import type { RankingCountry } from "./dataforseo-rankings.js";
export type KeywordSuggestion = {
    phrase: string;
    searchVolume: number | null;
    cpc: number | null;
    competition: number | null;
    difficulty: number | null;
    intent: string | null;
    cluster: string | null;
    monthlySearches: {
        year: number;
        month: number;
        searchVolume: number;
    }[];
};
export type SuggestionResult = {
    provider: "dataforseo_labs_keyword_suggestions";
    confidence: "PROVIDER_ESTIMATE";
    observedAt: string;
    billedCostUsd: number | null;
    totalCount: number;
    suggestions: KeywordSuggestion[];
};
export declare class DataForSeoSuggestionProvider {
    private readonly config;
    private readonly request;
    readonly id: "dataforseo_labs_keyword_suggestions";
    constructor(config: {
        login?: string;
        password?: string;
        enabled: boolean;
    }, request?: typeof fetch);
    suggest(input: {
        seed: string;
        country: RankingCountry;
        limit: number;
    }): Promise<SuggestionResult>;
}
export declare function configuredDataForSeoSuggestionProvider(request?: typeof fetch, overrides?: {
    login?: string;
    password?: string;
    enabled?: boolean;
}): DataForSeoSuggestionProvider;
