import { decryptIntegrationTokens, encryptIntegrationTokens } from "./integration-security.js";
export class GoogleIntegrationFailure extends Error {
    code;
    status;
    constructor(code, message, status) {
        super(message);
        this.code = code;
        this.status = status;
        this.name = "GoogleIntegrationFailure";
    }
}
const configFields = {
    "google-search-console": { clientId: "GOOGLE_SEARCH_CONSOLE_CLIENT_ID", clientSecret: "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET", scopes: ["https://www.googleapis.com/auth/webmasters.readonly"] },
    "google-analytics": { clientId: "GOOGLE_ANALYTICS_CLIENT_ID", clientSecret: "GOOGLE_ANALYTICS_CLIENT_SECRET", scopes: ["https://www.googleapis.com/auth/analytics.readonly"] },
    "google-ads": { clientId: "GOOGLE_ADS_CLIENT_ID", clientSecret: "GOOGLE_ADS_CLIENT_SECRET", scopes: ["https://www.googleapis.com/auth/adwords"] },
    youtube: { clientId: "GOOGLE_YOUTUBE_CLIENT_ID", clientSecret: "GOOGLE_YOUTUBE_CLIENT_SECRET", scopes: ["https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/yt-analytics.readonly"] },
    "google-business-profile": { clientId: "GOOGLE_BUSINESS_PROFILE_CLIENT_ID", clientSecret: "GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET", scopes: ["https://www.googleapis.com/auth/business.manage"] },
};
export function googleConfig(id, overrides) {
    const fields = configFields[id];
    return { id, clientId: overrides?.clientId ?? process.env[fields.clientId], clientSecret: overrides?.clientSecret ?? process.env[fields.clientSecret], redirectUri: overrides?.redirectUri ?? process.env.GOOGLE_OAUTH_REDIRECT_URI ?? "", scopes: fields.scopes, developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN };
}
export function googleConfigMissing(config) {
    return [!config.clientId && "OAuth client ID", !config.clientSecret && "OAuth client secret", !config.redirectUri && "OAuth redirect URI", !process.env.INTEGRATION_ENCRYPTION_KEY && "INTEGRATION_ENCRYPTION_KEY"].filter((x) => Boolean(x));
}
export function googleAuthorizationUrl(config, state) {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", config.scopes.join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    return url.toString();
}
export async function exchangeGoogleCode(config, code, request = fetch) {
    const form = new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: "authorization_code" });
    const response = await request("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(15_000) });
    const payload = await parseGoogleJson(response);
    if (!payload.access_token)
        throw new GoogleIntegrationFailure("token_exchange_failed", "Google did not return an access token.", response.status);
    return { accessToken: payload.access_token, refreshToken: payload.refresh_token ?? null, expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000, scope: payload.scope ?? config.scopes.join(" "), tokenType: payload.token_type ?? "Bearer" };
}
export async function refreshGoogleTokens(config, tokens, request = fetch) {
    if (tokens.expiresAt > Date.now() + 60_000)
        return tokens;
    if (!tokens.refreshToken)
        throw new GoogleIntegrationFailure("reauthorization_required", "The saved Google connection has no refresh token; reconnect the account.", 401);
    const form = new URLSearchParams({ refresh_token: tokens.refreshToken, client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token" });
    const response = await request("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(15_000) });
    const payload = await parseGoogleJson(response);
    if (!payload.access_token)
        throw new GoogleIntegrationFailure("token_refresh_failed", "Google could not refresh this connection; reconnect the account.", response.status);
    return { ...tokens, accessToken: payload.access_token, expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000, scope: payload.scope ?? tokens.scope, tokenType: payload.token_type ?? tokens.tokenType };
}
export async function authorizedGoogleFetch(config, tokens, url, init = {}, request = fetch) {
    const fresh = await refreshGoogleTokens(config, tokens, request);
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${fresh.accessToken}`);
    if (config.id === "google-ads" && config.developerToken)
        headers.set("developer-token", config.developerToken);
    return { response: await request(url, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(20_000) }), tokens: fresh };
}
export async function readEncryptedTokens(credentials) { try {
    return decryptIntegrationTokens(credentials);
}
catch {
    throw new GoogleIntegrationFailure("token_storage_error", "Saved integration credentials cannot be decrypted. Restore the workspace encryption key or reconnect.");
} }
export function encryptedTokenRecord(tokens) { return encryptIntegrationTokens(tokens); }
export async function parseGoogleJson(response) {
    let payload;
    try {
        payload = await response.json();
    }
    catch {
        throw new GoogleIntegrationFailure("invalid_response", "Google returned an unreadable response.", response.status);
    }
    if (!response.ok) {
        const error = payload.error && typeof payload.error === "object" ? payload.error : {};
        const code = typeof error.status === "string" ? error.status.toLowerCase() : `http_${response.status}`;
        if (response.status === 401)
            throw new GoogleIntegrationFailure("reauthorization_required", "Google rejected the access token; reconnect or refresh the account.", 401);
        if (response.status === 403)
            throw new GoogleIntegrationFailure("permission_denied", "Google denied access. Check the account permissions, enabled API, and OAuth scope.", 403);
        if (response.status === 429)
            throw new GoogleIntegrationFailure("rate_limited", "Google API quota was reached; retry later.", 429);
        throw new GoogleIntegrationFailure(code, `Google API request failed with HTTP ${response.status}.`, response.status);
    }
    return payload;
}
export async function listGoogleAccounts(config, tokens, request = fetch) {
    let url;
    if (config.id === "google-search-console")
        url = "https://www.googleapis.com/webmasters/v3/sites";
    else if (config.id === "google-analytics")
        url = "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200";
    else if (config.id === "google-ads")
        url = "https://googleads.googleapis.com/v26/customers:listAccessibleCustomers";
    else if (config.id === "youtube")
        url = "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true";
    else if (config.id === "google-business-profile")
        url = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
    else
        throw new GoogleIntegrationFailure("unsupported_provider", "This provider is not supported.");
    const result = await authorizedGoogleFetch(config, tokens, url, {}, request);
    const body = await parseGoogleJson(result.response);
    if (config.id === "google-search-console") {
        const sites = Array.isArray(body.siteEntry) ? body.siteEntry : [];
        return { accounts: sites.flatMap((site) => site.siteUrl ? [{ id: site.siteUrl, name: site.siteUrl, detail: site.permissionLevel ?? "permission unknown" }] : []), tokens: result.tokens };
    }
    if (config.id === "google-analytics") {
        const summaries = Array.isArray(body.accountSummaries) ? body.accountSummaries : [];
        return { accounts: summaries.flatMap((account) => (account.propertySummaries ?? []).flatMap((p) => p.property ? [{ id: p.property, name: p.displayName ?? p.property, detail: `${account.displayName ?? "GA account"} · ${p.propertyType ?? "property"}` }] : [])), tokens: result.tokens };
    }
    if (config.id === "google-ads") {
        const customers = Array.isArray(body.resourceNames) ? body.resourceNames : [];
        return { accounts: customers.flatMap((resource) => { const id = resource.split("/").pop(); return id ? [{ id, name: id, detail: "Accessible Google Ads customer" }] : []; }), tokens: result.tokens };
    }
    if (config.id === "google-business-profile") {
        const accounts = Array.isArray(body.accounts) ? body.accounts : [];
        return { accounts: accounts.flatMap((account) => account.name ? [{ id: account.name, name: account.accountName ?? account.name, detail: account.type ?? "Business Profile account" }] : []), tokens: result.tokens };
    }
    const channels = Array.isArray(body.items) ? body.items : [];
    return { accounts: channels.flatMap((channel) => channel.id ? [{ id: channel.id, name: channel.snippet?.title ?? channel.id, detail: "YouTube channel" }] : []), tokens: result.tokens };
}
export async function listGoogleBusinessLocations(config, tokens, request = fetch) {
    if (config.id !== "google-business-profile")
        throw new GoogleIntegrationFailure("unsupported_provider", "Business Profile locations require the Google Business Profile integration.");
    const accountId = tokens.accountId?.match(/^accounts\/([A-Za-z0-9_-]+)$/u)?.[1];
    if (!accountId)
        throw new GoogleIntegrationFailure("account_not_selected", "Select an accessible Business Profile account first.", 400);
    const locations = [];
    let freshTokens = tokens;
    let pageToken;
    for (let page = 0; page < 5; page++) {
        const url = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${accountId}/locations`);
        url.searchParams.set("readMask", "name,title,storeCode,websiteUri,phoneNumbers,storefrontAddress,primaryCategory,metadata");
        url.searchParams.set("pageSize", "100");
        if (pageToken)
            url.searchParams.set("pageToken", pageToken);
        const result = await authorizedGoogleFetch(config, freshTokens, url.toString(), {}, request);
        freshTokens = result.tokens;
        const body = await parseGoogleJson(result.response);
        for (const location of body.locations ?? [])
            if (typeof location.name === "string" && typeof location.title === "string") {
                locations.push({ name: `${tokens.accountId}/${location.name.replace(/^locations\//u, "locations/")}`, title: location.title, storeCode: typeof location.storeCode === "string" ? location.storeCode : null, websiteUri: typeof location.websiteUri === "string" ? location.websiteUri : null, primaryPhone: typeof location.phoneNumbers?.primaryPhone === "string" ? location.phoneNumbers.primaryPhone : null, storefrontAddress: location.storefrontAddress && typeof location.storefrontAddress === "object" ? location.storefrontAddress : null, primaryCategory: location.primaryCategory && typeof location.primaryCategory === "object" ? location.primaryCategory : null, metadata: location.metadata && typeof location.metadata === "object" ? location.metadata : null });
            }
        pageToken = body.nextPageToken;
        if (!pageToken)
            break;
    }
    return { locations, tokens: freshTokens };
}
export async function listGoogleBusinessReviews(config, tokens, locationName, request = fetch) {
    if (config.id !== "google-business-profile")
        throw new GoogleIntegrationFailure("unsupported_provider", "Business Profile reviews require the Google Business Profile integration.");
    const account = tokens.accountId?.match(/^accounts\/([A-Za-z0-9_-]+)$/u)?.[1];
    const match = locationName.match(/^accounts\/([A-Za-z0-9_-]+)\/locations\/([A-Za-z0-9_-]+)$/u);
    if (!account || !match || match[1] !== account)
        throw new GoogleIntegrationFailure("location_not_accessible", "The selected location does not belong to the connected Business Profile account.", 403);
    const url = new URL(`https://mybusiness.googleapis.com/v4/${locationName}/reviews`);
    url.searchParams.set("pageSize", "50");
    url.searchParams.set("orderBy", "updateTime desc");
    const result = await authorizedGoogleFetch(config, tokens, url.toString(), {}, request);
    const body = await parseGoogleJson(result.response);
    const ratings = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
    const reviews = (body.reviews ?? []).flatMap((review) => {
        const id = typeof review.reviewId === "string" ? review.reviewId : typeof review.name === "string" ? review.name.split("/").pop() : null;
        if (!id)
            return [];
        return [{ reviewId: id, reviewerName: typeof review.reviewer?.displayName === "string" ? review.reviewer.displayName : null, rating: typeof review.starRating === "number" ? review.starRating : typeof review.starRating === "string" ? ratings[review.starRating] ?? null : null, text: typeof review.comment === "string" ? review.comment : null, createTime: typeof review.createTime === "string" ? review.createTime : null, updateTime: typeof review.updateTime === "string" ? review.updateTime : null, reply: typeof review.reviewReply?.comment === "string" ? review.reviewReply.comment : null }];
    });
    return { reviews, averageRating: typeof body.averageRating === "number" ? body.averageRating : null, totalReviewCount: typeof body.totalReviewCount === "number" ? body.totalReviewCount : null, tokens: result.tokens };
}
export async function verifyGoogleAccount(config, tokens, accountId, request = fetch) {
    const { accounts, tokens: fresh } = await listGoogleAccounts(config, tokens, request);
    const account = accounts.find((item) => item.id === accountId);
    if (!account)
        throw new GoogleIntegrationFailure("account_not_accessible", "The selected account is not accessible to this Google user.", 403);
    return { ...fresh, accountId: account.id, accountName: account.name };
}
export async function getGoogleReport(config, tokens, input, request = fetch) {
    if (!tokens.accountId)
        throw new GoogleIntegrationFailure("account_not_selected", "Select an accessible account or property first.", 400);
    if (config.id === "google-search-console") {
        const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(tokens.accountId)}/searchAnalytics/query`;
        const filters = input.dimensionFilters?.map((filter) => ({ dimension: filter.dimension, operator: filter.operator === "equals" ? "equals" : "contains", expression: filter.expression }));
        const body = { startDate: input.startDate, endDate: input.endDate, dimensions: input.dimensions?.length ? input.dimensions : ["query"], rowLimit: 25000, startRow: 0, ...(filters?.length ? { dimensionFilterGroups: [{ groupType: "and", filters }] } : {}) };
        const result = await authorizedGoogleFetch(config, tokens, url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, request);
        return { report: await parseGoogleJson(result.response), tokens: result.tokens };
    }
    if (config.id === "google-analytics") {
        const propertyId = tokens.accountId.replace(/^properties\//u, "");
        const url = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`;
        const dimensionAllow = new Set(["date", "country", "deviceCategory", "sessionSource", "sessionMedium", "landingPage", "pagePath"]);
        const metricAllow = new Set(["sessions", "totalUsers", "newUsers", "activeUsers", "engagedSessions", "engagementRate", "screenPageViews", "conversions", "totalRevenue"]);
        const dimensions = (input.dimensions?.length ? input.dimensions : ["date"]).filter((item) => dimensionAllow.has(item));
        const metrics = (input.metrics?.length ? input.metrics : ["sessions", "totalUsers", "engagedSessions", "engagementRate"]).filter((item) => metricAllow.has(item));
        if (!metrics.length)
            throw new GoogleIntegrationFailure("invalid_report", "Choose at least one supported GA4 metric.", 400);
        const body = { dateRanges: [{ startDate: input.startDate, endDate: input.endDate }], dimensions: dimensions.map((name) => ({ name })), metrics: metrics.map((name) => ({ name })), limit: "100000" };
        const result = await authorizedGoogleFetch(config, tokens, url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, request);
        return { report: await parseGoogleJson(result.response), tokens: result.tokens };
    }
    if (config.id === "google-ads") {
        const customerId = tokens.accountId.replaceAll("-", "");
        const url = `https://googleads.googleapis.com/v26/customers/${encodeURIComponent(customerId)}/googleAds:searchStream`;
        const gaql = `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${input.startDate}' AND '${input.endDate}' ORDER BY segments.date DESC LIMIT 10000`;
        const result = await authorizedGoogleFetch(config, tokens, url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: gaql }) }, request);
        return { report: await parseGoogleJson(result.response), tokens: result.tokens };
    }
    throw new GoogleIntegrationFailure("report_unavailable", "Reporting for this provider is not implemented.");
}
export async function googleKeywordMetrics(config, tokens, input, request = fetch) {
    if (config.id !== "google-ads" || !tokens.accountId)
        throw new GoogleIntegrationFailure("account_not_selected", "Connect Google Ads and select an accessible customer account first.", 400);
    const customerId = tokens.accountId.replaceAll("-", "");
    const url = `https://googleads.googleapis.com/v26/customers/${encodeURIComponent(customerId)}:generateKeywordHistoricalMetrics`;
    const body = { keywords: input.keywords, geoTargetConstants: [`geoTargetConstants/${input.geoTarget}`], language: `languageConstants/${input.language}`, keywordPlanNetwork: "GOOGLE_SEARCH", historicalMetricsOptions: { includeAverageCpc: true } };
    const result = await authorizedGoogleFetch(config, tokens, url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, request);
    const payload = await parseGoogleJson(result.response);
    const keywords = (payload.results ?? []).flatMap((row) => {
        if (!row.text)
            return [];
        const metric = row.keywordMetrics ?? {};
        const competition = typeof metric.competitionIndex === "number" ? metric.competitionIndex / 100 : null;
        const cpcMicros = metric.averageCpcMicros ? Number(metric.averageCpcMicros) : NaN;
        const monthlySearches = (metric.monthlySearchVolumes ?? []).flatMap((m) => { const year = Number(m.year), month = Number(m.month), searchVolume = Number(m.monthlySearches); return Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(searchVolume) ? [{ year, month, searchVolume }] : []; });
        const searchVolume = metric.avgMonthlySearches === undefined ? null : Number(metric.avgMonthlySearches);
        return [{ phrase: row.text, searchVolume: Number.isFinite(searchVolume) ? searchVolume : null, cpc: Number.isFinite(cpcMicros) ? cpcMicros / 1_000_000 : null, competition, monthlySearches }];
    });
    return { keywords, tokens: result.tokens };
}
