import { type IntegrationCredentials } from "./integration-security.js";
export type WorkspaceProviderId = "dataforseo" | "openai" | "pagespeed" | "resend" | "linkedin" | "google-search-console" | "google-analytics" | "google-ads" | "youtube" | "google-business-profile";
export type WorkspaceCredentialField = {
    id: string;
    label: string;
    secret: boolean;
    env?: string;
};
export type WorkspaceProviderDefinition = {
    id: WorkspaceProviderId;
    name: string;
    fields: WorkspaceCredentialField[];
    test: "dataforseo" | "openai" | "pagespeed" | "resend" | "oauth";
};
export declare const workspaceProviders: WorkspaceProviderDefinition[];
export declare function workspaceProvider(id: string): WorkspaceProviderDefinition | undefined;
export declare function getWorkspaceProviderCredentials(organizationId: string, id: WorkspaceProviderId): Promise<IntegrationCredentials>;
export declare function getDataForSeoConfig(organizationId: string, feature: "keywordResearch" | "rankTracking" | "backlinks" | "competitors" | "mapRanking" | "traffic"): Promise<{
    login: string;
    password: string;
    enabled: boolean;
}>;
export declare function getOpenAiConfig(organizationId: string): Promise<{
    apiKey: string;
    model: string;
}>;
export declare function saveWorkspaceProviderCredentials(organizationId: string, id: WorkspaceProviderId, input: unknown): Promise<IntegrationCredentials>;
export declare function clearWorkspaceProviderCredentials(organizationId: string, id: WorkspaceProviderId): Promise<void>;
export declare function updateWorkspaceProviderCheck(organizationId: string, id: WorkspaceProviderId, status: string): Promise<void>;
export declare function listWorkspaceProviderStatuses(organizationId: string): Promise<{
    id: WorkspaceProviderId;
    name: string;
    test: "dataforseo" | "openai" | "pagespeed" | "resend" | "oauth";
    configured: boolean;
    missingConfiguration: string[];
    configuredFields: string[];
    fields: {
        id: string;
        label: string;
        secret: boolean;
    }[];
    status: string;
    lastCheckedAt: Date | null;
    workspaceOverride: boolean;
}[]>;
