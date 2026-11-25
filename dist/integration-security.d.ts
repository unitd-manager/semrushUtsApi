export type IntegrationTokens = {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: number;
    scope: string;
    tokenType: string;
    accountId?: string | null;
    accountName?: string | null;
};
export type IntegrationCredentials = Record<string, string>;
export declare function encryptIntegrationTokens(tokens: IntegrationTokens): Record<string, string | number>;
export declare function decryptIntegrationTokens(value: unknown): IntegrationTokens;
export declare function encryptIntegrationCredentials(credentials: IntegrationCredentials): Record<string, string | number>;
export declare function decryptIntegrationCredentials(value: unknown): IntegrationCredentials;
export declare function signOAuthState(payload: {
    organizationId: string;
    userId: string;
    provider: string;
    nonce: string;
    issuedAt: number;
}): string;
export declare function verifyOAuthState(value: string): {
    organizationId: string;
    userId: string;
    provider: string;
    nonce: string;
    issuedAt: number;
} | null;
