import { type IntegrationTokens } from "./integration-security.js";
export type GoogleIntegrationId = "google-search-console" | "google-analytics" | "google-ads" | "youtube" | "google-business-profile";
export type GoogleConfig = {
    id: GoogleIntegrationId;
    clientId?: string;
    clientSecret?: string;
    redirectUri: string;
    scopes: string[];
    developerToken?: string;
};
export declare class GoogleIntegrationFailure extends Error {
    readonly code: string;
    readonly status?: number | undefined;
    constructor(code: string, message: string, status?: number | undefined);
}
export declare function googleConfig(id: GoogleIntegrationId, overrides?: {
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
}): GoogleConfig;
export declare function googleConfigMissing(config: GoogleConfig): string[];
export declare function googleAuthorizationUrl(config: GoogleConfig, state: string): string;
export declare function exchangeGoogleCode(config: GoogleConfig, code: string, request?: typeof fetch): Promise<IntegrationTokens>;
export declare function refreshGoogleTokens(config: GoogleConfig, tokens: IntegrationTokens, request?: typeof fetch): Promise<IntegrationTokens>;
export declare function authorizedGoogleFetch(config: GoogleConfig, tokens: IntegrationTokens, url: string, init?: RequestInit, request?: typeof fetch): Promise<{
    response: Response;
    tokens: IntegrationTokens;
}>;
export declare function readEncryptedTokens(credentials: unknown): Promise<IntegrationTokens>;
export declare function encryptedTokenRecord(tokens: IntegrationTokens): Record<string, string | number>;
export declare function parseGoogleJson<T>(response: Response): Promise<T>;
export declare function listGoogleAccounts(config: GoogleConfig, tokens: IntegrationTokens, request?: typeof fetch): Promise<{
    accounts: {
        id: string;
        name: string;
        detail?: string;
    }[];
    tokens: IntegrationTokens;
}>;
export type GoogleBusinessLocation = {
    name: string;
    title: string;
    storeCode: string | null;
    websiteUri: string | null;
    primaryPhone: string | null;
    storefrontAddress: Record<string, unknown> | null;
    primaryCategory: Record<string, unknown> | null;
    metadata: Record<string, unknown> | null;
};
export declare function listGoogleBusinessLocations(config: GoogleConfig, tokens: IntegrationTokens, request?: typeof fetch): Promise<{
    locations: GoogleBusinessLocation[];
    tokens: IntegrationTokens;
}>;
export type GoogleBusinessReview = {
    reviewId: string;
    reviewerName: string | null;
    rating: number | null;
    text: string | null;
    createTime: string | null;
    updateTime: string | null;
    reply: string | null;
};
export declare function listGoogleBusinessReviews(config: GoogleConfig, tokens: IntegrationTokens, locationName: string, request?: typeof fetch): Promise<{
    reviews: GoogleBusinessReview[];
    averageRating: number | null;
    totalReviewCount: number | null;
    tokens: IntegrationTokens;
}>;
export declare function verifyGoogleAccount(config: GoogleConfig, tokens: IntegrationTokens, accountId: string, request?: typeof fetch): Promise<IntegrationTokens>;
export declare function getGoogleReport(config: GoogleConfig, tokens: IntegrationTokens, input: {
    startDate: string;
    endDate: string;
    dimensions?: string[];
    metrics?: string[];
    dimensionFilters?: {
        dimension: string;
        operator: "equals" | "contains";
        expression: string;
    }[];
}, request?: typeof fetch): Promise<{
    report: unknown;
    tokens: IntegrationTokens;
}>;
export declare function googleKeywordMetrics(config: GoogleConfig, tokens: IntegrationTokens, input: {
    keywords: string[];
    geoTarget: string;
    language: string;
}, request?: typeof fetch): Promise<{
    keywords: {
        phrase: string;
        searchVolume: number | null;
        cpc: number | null;
        competition: number | null;
        monthlySearches: {
            year: number;
            month: number;
            searchVolume: number;
        }[];
    }[];
    tokens: IntegrationTokens;
}>;
