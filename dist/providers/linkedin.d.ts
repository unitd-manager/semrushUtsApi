import type { IntegrationTokens } from "../integration-security.js";
export declare class LinkedInFailure extends Error {
    readonly status: number;
    readonly code: string;
    constructor(message: string, status: number, code: string);
}
export declare function linkedInConfig(overrides?: {
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
    version?: string;
}): {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    version: string;
};
export declare function linkedInAuthorizationUrl(config: ReturnType<typeof linkedInConfig>, state: string): string;
export declare function exchangeLinkedInCode(config: ReturnType<typeof linkedInConfig>, code: string, request?: typeof fetch): Promise<{
    accessToken: string;
    refreshToken: string | null;
    expiresAt: number;
    scope: string;
    tokenType: string;
}>;
export declare function linkedInProfile(tokens: IntegrationTokens, request?: typeof fetch, version?: string): Promise<{
    id: string;
    name: string;
}>;
export declare function publishLinkedInText(tokens: IntegrationTokens, author: string, commentary: string, request?: typeof fetch, version?: string): Promise<{
    id: string;
    url: string;
    publishedAt: string;
}>;
export declare function linkedInSocialActions(tokens: IntegrationTokens, postUrn: string, request?: typeof fetch, version?: string): Promise<{
    postUrn: string;
    likes: number;
    comments: number;
    observedAt: string;
    source: string;
}>;
