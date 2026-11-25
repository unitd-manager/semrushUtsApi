import { decryptIntegrationCredentials, encryptIntegrationCredentials } from "./integration-security.js";
import { prisma } from "./db.js";
export const workspaceProviders = [
    { id: "dataforseo", name: "DataForSEO", test: "dataforseo", fields: [
            { id: "login", label: "API login", secret: false, env: "DATAFORSEO_LOGIN" },
            { id: "password", label: "API password", secret: true, env: "DATAFORSEO_PASSWORD" },
            { id: "keywordResearch", label: "Keyword research enabled", secret: false, env: "DATAFORSEO_KEYWORD_RESEARCH_ENABLED" },
            { id: "rankTracking", label: "Rank tracking enabled", secret: false, env: "DATAFORSEO_RANK_TRACKING_ENABLED" },
            { id: "backlinks", label: "Backlinks enabled", secret: false, env: "DATAFORSEO_BACKLINKS_ENABLED" },
            { id: "competitors", label: "Competitor research enabled", secret: false, env: "DATAFORSEO_COMPETITORS_ENABLED" },
            { id: "mapRanking", label: "Map ranking enabled", secret: false, env: "DATAFORSEO_MAP_RANKING_ENABLED" },
            { id: "traffic", label: "Traffic estimates enabled", secret: false, env: "DATAFORSEO_TRAFFIC_ENABLED" },
        ] },
    { id: "openai", name: "OpenAI", test: "openai", fields: [
            { id: "apiKey", label: "API key", secret: true, env: "OPENAI_API_KEY" },
            { id: "model", label: "Model", secret: false, env: "OPENAI_MODEL" },
        ] },
    { id: "pagespeed", name: "Google PageSpeed Insights", test: "pagespeed", fields: [
            { id: "apiKey", label: "API key", secret: true, env: "PAGESPEED_API_KEY" },
        ] },
    { id: "resend", name: "Resend email", test: "resend", fields: [
            { id: "apiKey", label: "API key", secret: true, env: "RESEND_API_KEY" },
            { id: "from", label: "Verified sender", secret: false, env: "REPORT_EMAIL_FROM" },
        ] },
    { id: "linkedin", name: "LinkedIn", test: "oauth", fields: [
            { id: "clientId", label: "OAuth client ID", secret: false, env: "LINKEDIN_CLIENT_ID" },
            { id: "clientSecret", label: "OAuth client secret", secret: true, env: "LINKEDIN_CLIENT_SECRET" },
            { id: "redirectUri", label: "OAuth redirect URI", secret: false, env: "LINKEDIN_REDIRECT_URI" },
            { id: "version", label: "API version", secret: false, env: "LINKEDIN_API_VERSION" },
        ] },
    ...[
        ["google-search-console", "Google Search Console", "GOOGLE_SEARCH_CONSOLE"],
        ["google-analytics", "Google Analytics 4", "GOOGLE_ANALYTICS"],
        ["google-ads", "Google Ads", "GOOGLE_ADS"],
        ["youtube", "YouTube", "GOOGLE_YOUTUBE"],
        ["google-business-profile", "Google Business Profile", "GOOGLE_BUSINESS_PROFILE"],
    ].map(([id, name, envPrefix]) => ({
        id,
        name,
        test: "oauth",
        fields: [
            { id: "clientId", label: "OAuth client ID", secret: false, env: `${envPrefix}_CLIENT_ID` },
            { id: "clientSecret", label: "OAuth client secret", secret: true, env: `${envPrefix}_CLIENT_SECRET` },
            { id: "redirectUri", label: "OAuth callback URI", secret: false, env: "GOOGLE_OAUTH_REDIRECT_URI" },
        ],
    })),
];
export function workspaceProvider(id) {
    return workspaceProviders.find((provider) => provider.id === id);
}
function providerRecordId(id) { return `settings:${id}`; }
export async function getWorkspaceProviderCredentials(organizationId, id) {
    const provider = workspaceProvider(id);
    const stored = await prisma.integration.findUnique({ where: { organizationId_provider: { organizationId, provider: providerRecordId(id) } } });
    const credentials = {};
    for (const field of provider.fields) {
        const value = field.env ? process.env[field.env] : undefined;
        if (value)
            credentials[field.id] = value;
    }
    if (stored?.encryptedCredentials)
        Object.assign(credentials, decryptIntegrationCredentials(stored.encryptedCredentials));
    return credentials;
}
export async function getDataForSeoConfig(organizationId, feature) {
    const credentials = await getWorkspaceProviderCredentials(organizationId, "dataforseo");
    return { login: credentials.login, password: credentials.password, enabled: credentials[feature] === "true" };
}
export async function getOpenAiConfig(organizationId) {
    const credentials = await getWorkspaceProviderCredentials(organizationId, "openai");
    return { apiKey: credentials.apiKey?.trim() ?? "", model: credentials.model?.trim() || "gpt-4.1-mini" };
}
export async function saveWorkspaceProviderCredentials(organizationId, id, input) {
    const provider = workspaceProvider(id);
    if (!input || typeof input !== "object" || Array.isArray(input))
        throw Object.assign(new Error("Credentials must be an object."), { status: 400, code: "invalid_credentials" });
    const submitted = input;
    const allowed = new Set(provider.fields.map((field) => field.id));
    if (Object.keys(submitted).some((field) => !allowed.has(field)))
        throw Object.assign(new Error("One or more credential fields are not supported."), { status: 400, code: "unsupported_credential_field" });
    const credentials = await getWorkspaceProviderCredentials(organizationId, id);
    for (const [field, value] of Object.entries(submitted)) {
        if (typeof value !== "string" || value.length > 2048)
            throw Object.assign(new Error("Credential values must be text no longer than 2048 characters."), { status: 400, code: "invalid_credential_value" });
        const trimmed = value.trim();
        if (trimmed)
            credentials[field] = trimmed;
    }
    const settingsOnly = {};
    for (const field of provider.fields) {
        const value = submitted[field.id];
        if (typeof value === "string" && value.trim())
            settingsOnly[field.id] = value.trim();
    }
    const previous = await prisma.integration.findUnique({ where: { organizationId_provider: { organizationId, provider: providerRecordId(id) } } });
    const saved = previous?.encryptedCredentials ? decryptIntegrationCredentials(previous.encryptedCredentials) : {};
    for (const [field, value] of Object.entries(settingsOnly))
        saved[field] = value;
    if (!Object.keys(saved).length)
        throw Object.assign(new Error("Enter at least one setting before saving."), { status: 400, code: "credentials_empty" });
    await prisma.integration.upsert({
        where: { organizationId_provider: { organizationId, provider: providerRecordId(id) } },
        create: { organizationId, provider: providerRecordId(id), status: "configured", encryptedCredentials: encryptIntegrationCredentials(saved) },
        update: { status: "configured", encryptedCredentials: encryptIntegrationCredentials(saved) },
    });
    return credentials;
}
export async function clearWorkspaceProviderCredentials(organizationId, id) {
    await prisma.integration.deleteMany({ where: { organizationId, provider: providerRecordId(id) } });
}
export async function updateWorkspaceProviderCheck(organizationId, id, status) {
    await prisma.integration.upsert({
        where: { organizationId_provider: { organizationId, provider: providerRecordId(id) } },
        create: { organizationId, provider: providerRecordId(id), status, lastCheckedAt: new Date() },
        update: { status, lastCheckedAt: new Date() },
    });
}
export async function listWorkspaceProviderStatuses(organizationId) {
    return Promise.all(workspaceProviders.map(async (provider) => {
        const credentials = await getWorkspaceProviderCredentials(organizationId, provider.id);
        const record = await prisma.integration.findUnique({ where: { organizationId_provider: { organizationId, provider: providerRecordId(provider.id) } }, select: { status: true, lastCheckedAt: true, encryptedCredentials: true } });
        const missing = provider.fields.filter((field) => ["apiKey", "login", "password", "clientId", "clientSecret", "redirectUri", "from"].includes(field.id) && !credentials[field.id]).map((field) => field.id);
        return {
            id: provider.id,
            name: provider.name,
            test: provider.test,
            configured: missing.length === 0,
            missingConfiguration: missing,
            configuredFields: provider.fields.filter((field) => Boolean(credentials[field.id])).map((field) => field.id),
            fields: provider.fields.map(({ id, label, secret }) => ({ id, label, secret })),
            status: record?.status ?? (missing.length ? "not_configured" : "configured"),
            lastCheckedAt: record?.lastCheckedAt ?? null,
            workspaceOverride: Boolean(record?.encryptedCredentials),
        };
    }));
}
