export type KeywordQuery = {
    phrase: string;
    searchVolume: number | null;
    cpc: number | null;
    competition: number | null;
    monthlySearches: {
        year: number;
        month: number;
        searchVolume: number;
    }[];
};
export type KeywordResearchResult = {
    provider: "dataforseo";
    observedAt: string;
    confidence: "PROVIDER_ESTIMATE";
    billedCostUsd: number | null;
    keywords: KeywordQuery[];
};
export type KeywordResearchInput = {
    keywords: string[];
    country: "US" | "GB" | "CA" | "AU" | "IN";
};
export type ProviderFailureCode = "not_configured" | "http_error" | "provider_error" | "invalid_response" | "timeout" | "insufficient_funds" | "credentials_invalid" | "account_suspended" | "rate_limited";
export declare class ProviderFailure extends Error {
    readonly code: ProviderFailureCode;
    readonly details: {
        httpStatus?: number;
        providerStatus?: number;
        retryable?: boolean;
    };
    constructor(code: ProviderFailureCode, message: string, details?: {
        httpStatus?: number;
        providerStatus?: number;
        retryable?: boolean;
    });
}
export interface KeywordResearchProvider {
    readonly id: "dataforseo" | "google-ads";
    research(input: KeywordResearchInput): Promise<KeywordResearchResult>;
}
export declare class DataForSeoKeywordProvider implements KeywordResearchProvider {
    private readonly config;
    private readonly request;
    readonly id: "dataforseo";
    constructor(config: {
        login?: string;
        password?: string;
        enabled: boolean;
    }, request?: typeof fetch);
    research(input: KeywordResearchInput): Promise<KeywordResearchResult>;
    healthCheck(): Promise<{
        provider: "dataforseo";
        status: "ready" | "insufficient_funds" | "credentials_invalid" | "account_suspended" | "unavailable" | "not_configured";
        credentialsValid: boolean;
        balance: number | null;
        checkedAt: string;
        message: string;
    }>;
}
export declare function configuredDataForSeoKeywordProvider(request?: typeof fetch, overrides?: {
    login?: string;
    password?: string;
    enabled?: boolean;
}): DataForSeoKeywordProvider;
