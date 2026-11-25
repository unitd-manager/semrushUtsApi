export class ProviderFailure extends Error {
    code;
    details;
    constructor(code, message, details = {}) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = "ProviderFailure";
    }
}
const locationCodes = { US: 2840, GB: 2826, CA: 2124, AU: 2036, IN: 2356 };
function numeric(value) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
export class DataForSeoKeywordProvider {
    config;
    request;
    id = "dataforseo";
    constructor(config, request = fetch) {
        this.config = config;
        this.request = request;
    }
    async research(input) {
        if (!this.config.enabled || !this.config.login || !this.config.password)
            throw new ProviderFailure("not_configured", "DataForSEO keyword research is not enabled or its service credentials are missing.");
        const credentials = Buffer.from(`${this.config.login}:${this.config.password}`).toString("base64");
        let response;
        try {
            response = await this.request("https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live", {
                method: "POST",
                headers: { authorization: `Basic ${credentials}`, "content-type": "application/json" },
                body: JSON.stringify([{ keywords: input.keywords, location_code: locationCodes[input.country], language_code: "en", include_adult_keywords: false }]),
                signal: AbortSignal.timeout(25_000),
            });
        }
        catch (error) {
            if (error instanceof Error && error.name === "TimeoutError")
                throw new ProviderFailure("timeout", "The keyword data provider did not respond before the request deadline.");
            throw new ProviderFailure("http_error", "The keyword data provider could not be reached.");
        }
        if (!response.ok)
            throw await classifyHttpFailure(response);
        let payload;
        try {
            payload = await response.json();
        }
        catch {
            throw new ProviderFailure("invalid_response", "The keyword data provider returned an unreadable response.");
        }
        const task = payload.tasks?.[0];
        if (!task)
            throw new ProviderFailure("invalid_response", "The keyword data provider returned no task result.");
        if (task.status_code !== 20000)
            throw classifyProviderFailure(task.status_code);
        const items = task.result;
        if (!Array.isArray(items))
            throw new ProviderFailure("invalid_response", "The provider response did not contain keyword metrics.");
        const observedAt = new Date().toISOString();
        return {
            provider: this.id,
            observedAt,
            confidence: "PROVIDER_ESTIMATE",
            billedCostUsd: numeric(task.cost),
            keywords: items.flatMap((item) => {
                const phrase = typeof item.keyword === "string" ? item.keyword : null;
                if (!phrase)
                    return [];
                const monthly = Array.isArray(item.monthly_searches) ? item.monthly_searches.flatMap((month) => {
                    if (!month || typeof month !== "object")
                        return [];
                    const row = month;
                    if (typeof row.year !== "number" || typeof row.month !== "number" || typeof row.search_volume !== "number")
                        return [];
                    return [{ year: row.year, month: row.month, searchVolume: row.search_volume }];
                }) : [];
                return [{ phrase, searchVolume: numeric(item.search_volume), cpc: numeric(item.cpc), competition: numeric(item.competition_index), monthlySearches: monthly }];
            }),
        };
    }
    async healthCheck() {
        const checkedAt = new Date().toISOString();
        if (!this.config.enabled || !this.config.login || !this.config.password)
            return { provider: this.id, status: "not_configured", credentialsValid: false, balance: null, checkedAt, message: "DataForSEO keyword research is not enabled or its credentials are missing." };
        const credentials = Buffer.from(`${this.config.login}:${this.config.password}`).toString("base64");
        let response;
        try {
            response = await this.request("https://api.dataforseo.com/v3/appendix/user_data", { headers: { authorization: `Basic ${credentials}`, accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
        }
        catch (error) {
            return { provider: this.id, status: "unavailable", credentialsValid: false, balance: null, checkedAt, message: error instanceof Error && error.name === "TimeoutError" ? "DataForSEO account status request timed out." : "DataForSEO account status could not be reached." };
        }
        let payload = {};
        try {
            payload = await response.json();
        }
        catch {
            return { provider: this.id, status: "unavailable", credentialsValid: false, balance: null, checkedAt, message: "DataForSEO returned an unreadable account status." };
        }
        const task = payload.tasks?.[0];
        const code = task?.status_code ?? payload.status_code;
        if (!response.ok || code === 40200 || response.status === 402)
            return { provider: this.id, status: "insufficient_funds", credentialsValid: response.status !== 401, balance: null, checkedAt, message: "DataForSEO reports that the account balance must be recharged." };
        if (code === 40201)
            return { provider: this.id, status: "account_suspended", credentialsValid: true, balance: null, checkedAt, message: "DataForSEO has temporarily paused this account; contact provider support." };
        if (response.status === 401 || code === 40100)
            return { provider: this.id, status: "credentials_invalid", credentialsValid: false, balance: null, checkedAt, message: "DataForSEO rejected the API credentials." };
        if (code !== 20000)
            return { provider: this.id, status: "unavailable", credentialsValid: true, balance: null, checkedAt, message: "DataForSEO account status is unavailable." };
        const money = task?.result?.[0]?.money;
        const balance = numeric(money?.balance);
        const status = balance !== null && balance < 0 ? "insufficient_funds" : "ready";
        return { provider: this.id, status, credentialsValid: true, balance, checkedAt, message: status === "ready" ? "DataForSEO credentials are valid and the account balance is non-negative." : "DataForSEO credentials are valid, but the account balance must be recharged." };
    }
}
async function classifyHttpFailure(response) {
    let status;
    try {
        const payload = await response.clone().json();
        const value = payload.tasks?.[0]?.status_code ?? payload.status_code;
        status = typeof value === "number" ? value : undefined;
    }
    catch { /* provider may return a non-JSON HTTP error */ }
    if (response.status === 401)
        return new ProviderFailure("credentials_invalid", "The keyword provider rejected the configured credentials.", { httpStatus: 401, providerStatus: status });
    if (response.status === 402 || status === 40200)
        return new ProviderFailure("insufficient_funds", "DataForSEO returned HTTP 402: the account cannot be billed until its balance is recharged.", { httpStatus: response.status, providerStatus: status, retryable: false });
    if (status === 40201)
        return new ProviderFailure("account_suspended", "DataForSEO temporarily paused this account; contact provider support.", { httpStatus: response.status, providerStatus: status, retryable: false });
    if (response.status === 429)
        return new ProviderFailure("rate_limited", "The keyword data provider rate limit was reached.", { httpStatus: 429, providerStatus: status, retryable: true });
    return new ProviderFailure("http_error", `The keyword data provider returned HTTP ${response.status}.`, { httpStatus: response.status, providerStatus: status, retryable: response.status >= 500 });
}
function classifyProviderFailure(status) {
    if (status === 40200)
        return new ProviderFailure("insufficient_funds", "DataForSEO returned HTTP 402: the account cannot be billed until its balance is recharged.", { providerStatus: status, retryable: false });
    if (status === 40201)
        return new ProviderFailure("account_suspended", "DataForSEO temporarily paused this account; contact provider support.", { providerStatus: status, retryable: false });
    if (status === 40100 || status === 40101 || status === 40104)
        return new ProviderFailure("credentials_invalid", "DataForSEO rejected or requires verification for the configured credentials.", { providerStatus: status, retryable: false });
    return new ProviderFailure("provider_error", `The keyword data provider rejected this request (task status ${typeof status === "number" ? status : "unknown"}).`, { providerStatus: status, retryable: false });
}
export function configuredDataForSeoKeywordProvider(request = fetch, overrides) {
    return new DataForSeoKeywordProvider({ login: overrides?.login ?? process.env.DATAFORSEO_LOGIN, password: overrides?.password ?? process.env.DATAFORSEO_PASSWORD, enabled: overrides?.enabled ?? process.env.DATAFORSEO_KEYWORD_RESEARCH_ENABLED === "true" }, request);
}
