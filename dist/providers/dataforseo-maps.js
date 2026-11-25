import { ProviderFailure } from "./dataforseo.js";
function normalizedHost(value) {
    try {
        return new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./u, "");
    }
    catch {
        return null;
    }
}
export class DataForSeoMapsProvider {
    config;
    request;
    id = "dataforseo-google-maps";
    constructor(config, request = fetch) {
        this.config = config;
        this.request = request;
    }
    async check(input) {
        if (!this.config.enabled || !this.config.login || !this.config.password)
            throw new ProviderFailure("not_configured", "DataForSEO Google Maps rank checks are not enabled or service credentials are missing.");
        if (!input.keywords.length || input.keywords.length > 3 || input.points.length !== 9)
            throw new ProviderFailure("invalid_response", "Map ranking checks require one to three keywords and exactly nine grid points.");
        const expectedHost = normalizedHost(input.targetHost);
        if (!expectedHost)
            throw new ProviderFailure("invalid_response", "The project primary host is invalid.");
        const tasks = input.keywords.flatMap((keyword) => input.points.map((point) => ({ keyword, location_coordinate: point.coordinate, language_code: input.languageCode ?? "en", depth: 100, search_this_area: true, search_places: false })));
        const authorization = Buffer.from(`${this.config.login}:${this.config.password}`).toString("base64");
        let response;
        try {
            response = await this.request("https://api.dataforseo.com/v3/serp/google/maps/live/advanced", { method: "POST", headers: { authorization: `Basic ${authorization}`, "content-type": "application/json" }, body: JSON.stringify(tasks), signal: AbortSignal.timeout(45_000) });
        }
        catch (error) {
            if (error instanceof Error && error.name === "TimeoutError")
                throw new ProviderFailure("timeout", "The map rank provider did not respond before the request deadline.");
            throw new ProviderFailure("http_error", "The map rank provider could not be reached.");
        }
        if (!response.ok)
            throw new ProviderFailure("http_error", `The map rank provider returned HTTP ${response.status}.`);
        let payload;
        try {
            payload = await response.json();
        }
        catch {
            throw new ProviderFailure("invalid_response", "The map rank provider returned unreadable results.");
        }
        if (!Array.isArray(payload.tasks) || payload.tasks.length !== tasks.length)
            throw new ProviderFailure("invalid_response", "The map rank provider returned an incomplete set of grid results.");
        let totalCost = 0;
        const allCostsPresent = payload.tasks.every((task) => typeof task.cost === "number" && Number.isFinite(task.cost));
        const observedAt = new Date().toISOString();
        const observations = payload.tasks.map((task, index) => {
            if (task.status_code !== 20000)
                throw new ProviderFailure("provider_error", "The map rank provider rejected one or more grid checks.");
            if (typeof task.cost === "number" && Number.isFinite(task.cost))
                totalCost += task.cost;
            const inputTask = tasks[index];
            const point = input.points[index % input.points.length];
            const result = task.result?.[0];
            if (!result || !Array.isArray(result.items))
                throw new ProviderFailure("invalid_response", "The map rank provider omitted a grid result.");
            const providerDate = typeof result.datetime === "string" ? new Date(result.datetime) : null;
            const matches = result.items.filter((item) => {
                if (item.type !== "maps_search")
                    return false;
                const candidate = typeof item.domain === "string" ? normalizedHost(item.domain) : typeof item.url === "string" ? normalizedHost(item.url) : null;
                return candidate === expectedHost || candidate?.endsWith(`.${expectedHost}`) === true;
            }).sort((a, b) => (typeof a.rank_absolute === "number" ? a.rank_absolute : Infinity) - (typeof b.rank_absolute === "number" ? b.rank_absolute : Infinity));
            const match = matches[0];
            return {
                keyword: inputTask.keyword, point: point.label, coordinate: point.coordinate,
                position: typeof match?.rank_absolute === "number" ? match.rank_absolute : null,
                listingName: typeof match?.title === "string" ? match.title : null,
                listingUrl: typeof match?.url === "string" ? match.url : null,
                placeId: typeof match?.place_id === "string" ? match.place_id : null,
                rating: typeof match?.rating?.value === "number" ? match.rating.value : null,
                reviews: typeof match?.rating?.votes_count === "number" ? match.rating.votes_count : null,
                checkedAt: providerDate && Number.isFinite(providerDate.getTime()) ? providerDate.toISOString() : observedAt,
            };
        });
        return { provider: this.id, confidence: "PROVIDER_OBSERVED", billedCostUsd: allCostsPresent ? totalCost : null, observations };
    }
}
export function configuredDataForSeoMapsProvider(request = fetch, overrides) {
    return new DataForSeoMapsProvider({ login: overrides?.login ?? process.env.DATAFORSEO_LOGIN, password: overrides?.password ?? process.env.DATAFORSEO_PASSWORD, enabled: overrides?.enabled ?? process.env.DATAFORSEO_MAP_RANKING_ENABLED === "true" }, request);
}
