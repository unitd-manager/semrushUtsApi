import { ProviderFailure } from "./dataforseo.js";
const locationCodes = { US: 2840, GB: 2826, CA: 2124, AU: 2036, IN: 2356 };
export class DataForSeoRankingProvider {
    config;
    request;
    id = "dataforseo";
    constructor(config, request = fetch) {
        this.config = config;
        this.request = request;
    }
    async check(input) {
        if (!this.config.enabled || !this.config.login || !this.config.password)
            throw new ProviderFailure("not_configured", "DataForSEO rank checks are not enabled or service credentials are missing.");
        const credentials = Buffer.from(`${this.config.login}:${this.config.password}`).toString("base64");
        let response;
        try {
            response = await this.request("https://api.dataforseo.com/v3/serp/google/organic/live/advanced", {
                method: "POST", headers: { authorization: `Basic ${credentials}`, "content-type": "application/json" },
                body: JSON.stringify(input.keywords.map((keyword) => ({ keyword, location_code: locationCodes[input.country], language_code: "en", device: input.device, depth: input.depth ?? 10 }))),
                signal: AbortSignal.timeout(30_000),
            });
        }
        catch (error) {
            if (error instanceof Error && error.name === "TimeoutError")
                throw new ProviderFailure("timeout", "The rank provider did not respond before the request deadline.");
            throw new ProviderFailure("http_error", "The rank provider could not be reached.");
        }
        if (!response.ok)
            throw new ProviderFailure("http_error", `The rank provider returned HTTP ${response.status}.`);
        let payload;
        try {
            payload = await response.json();
        }
        catch {
            throw new ProviderFailure("invalid_response", "The rank provider returned unreadable results.");
        }
        const tasks = payload.tasks;
        if (!Array.isArray(tasks) || tasks.length !== input.keywords.length)
            throw new ProviderFailure("invalid_response", "The rank provider returned an incomplete task list.");
        const target = input.targetHost.toLowerCase().replace(/^www\./u, "");
        const observedAt = new Date().toISOString();
        let cost = 0;
        const observations = tasks.map((task, index) => {
            if (task.status_code !== 20000)
                throw new ProviderFailure("provider_error", "The rank provider rejected one or more keyword checks.");
            if (typeof task.cost === "number" && Number.isFinite(task.cost))
                cost += task.cost;
            const result = task.result?.[0];
            if (!result || !Array.isArray(result.items))
                throw new ProviderFailure("invalid_response", "The rank provider omitted search results for a keyword.");
            const matches = result.items.filter((item) => {
                if (item.type !== "organic" || typeof item.domain !== "string")
                    return false;
                const candidate = item.domain.toLowerCase().replace(/^www\./u, "");
                return candidate === target || candidate.endsWith(`.${target}`);
            }).sort((left, right) => (typeof left.rank_absolute === "number" ? left.rank_absolute : Infinity) - (typeof right.rank_absolute === "number" ? right.rank_absolute : Infinity));
            const match = matches[0];
            return { keyword: input.keywords[index], position: typeof match?.rank_absolute === "number" ? match.rank_absolute : null, url: typeof match?.url === "string" ? match.url : null, observedAt };
        });
        return { provider: this.id, confidence: "PROVIDER_OBSERVED", billedCostUsd: tasks.every((task) => typeof task.cost === "number") ? cost : null, observations };
    }
}
export function configuredDataForSeoRankingProvider(request = fetch, overrides) {
    return new DataForSeoRankingProvider({ login: overrides?.login ?? process.env.DATAFORSEO_LOGIN, password: overrides?.password ?? process.env.DATAFORSEO_PASSWORD, enabled: overrides?.enabled ?? process.env.DATAFORSEO_RANK_TRACKING_ENABLED === "true" }, request);
}
