import { ProviderFailure } from "./dataforseo.js";
function numeric(value) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function dateText(value) { return typeof value === "string" && value.length > 0 ? value : null; }
export class DataForSeoBacklinkProvider {
    config;
    request;
    id = "dataforseo_backlinks";
    constructor(config, request = fetch) {
        this.config = config;
        this.request = request;
    }
    async summarize(target) {
        if (!this.config.enabled || !this.config.login || !this.config.password)
            throw new ProviderFailure("not_configured", "DataForSEO backlink analysis is not enabled or service credentials are missing.");
        let response;
        try {
            response = await this.request("https://api.dataforseo.com/v3/backlinks/summary/live", {
                method: "POST", headers: { authorization: `Basic ${Buffer.from(`${this.config.login}:${this.config.password}`).toString("base64")}`, "content-type": "application/json" },
                body: JSON.stringify([{ target, include_subdomains: true, exclude_internal_backlinks: true, backlinks_status_type: "all", rank_scale: "one_thousand" }]),
                signal: AbortSignal.timeout(30_000),
            });
        }
        catch (error) {
            if (error instanceof Error && error.name === "TimeoutError")
                throw new ProviderFailure("timeout", "The backlink provider did not respond before the request deadline.");
            throw new ProviderFailure("http_error", "The backlink provider could not be reached.");
        }
        if (!response.ok)
            throw new ProviderFailure("http_error", `The backlink provider returned HTTP ${response.status}.`);
        let payload;
        try {
            payload = await response.json();
        }
        catch {
            throw new ProviderFailure("invalid_response", "The backlink provider returned unreadable results.");
        }
        const task = payload.tasks?.[0];
        if (!task)
            throw new ProviderFailure("invalid_response", "The backlink provider returned no task.");
        if (task.status_code !== 20000)
            throw new ProviderFailure("provider_error", "The backlink provider rejected the summary request.");
        const row = task.result?.[0];
        if (!row)
            throw new ProviderFailure("invalid_response", "The backlink provider returned no summary for the target.");
        return {
            provider: this.id, confidence: "PROVIDER_OBSERVED", observedAt: new Date().toISOString(), billedCostUsd: numeric(task.cost),
            summary: {
                target: typeof row.target === "string" ? row.target : target,
                targetRank: numeric(row.rank), backlinks: numeric(row.backlinks), referringDomains: numeric(row.referring_domains),
                referringMainDomains: numeric(row.referring_main_domains), referringIps: numeric(row.referring_ips), referringPages: numeric(row.referring_pages),
                brokenBacklinks: numeric(row.broken_backlinks), backlinkSpamScore: numeric(row.backlinks_spam_score), targetSpamScore: numeric(row.info?.target_spam_score),
                firstSeen: dateText(row.first_seen), lostDate: dateText(row.lost_date), crawledPages: numeric(row.crawled_pages),
            },
        };
    }
    async list(input) {
        if (!this.config.enabled || !this.config.login || !this.config.password)
            throw new ProviderFailure("not_configured", "DataForSEO backlink analysis is not enabled or service credentials are missing.");
        let response;
        try {
            response = await this.request("https://api.dataforseo.com/v3/backlinks/backlinks/live", {
                method: "POST", headers: { authorization: `Basic ${Buffer.from(`${this.config.login}:${this.config.password}`).toString("base64")}`, "content-type": "application/json" },
                body: JSON.stringify([{ target: input.target, mode: "as_is", backlinks_status_type: input.status, include_subdomains: true, exclude_internal_backlinks: true, limit: input.limit, offset: input.offset, rank_scale: "one_thousand" }]),
                signal: AbortSignal.timeout(30_000),
            });
        }
        catch (error) {
            if (error instanceof Error && error.name === "TimeoutError")
                throw new ProviderFailure("timeout", "The backlink provider did not respond before the request deadline.");
            throw new ProviderFailure("http_error", "The backlink provider could not be reached.");
        }
        if (!response.ok)
            throw new ProviderFailure("http_error", `The backlink provider returned HTTP ${response.status}.`);
        let payload;
        try {
            payload = await response.json();
        }
        catch {
            throw new ProviderFailure("invalid_response", "The backlink provider returned unreadable results.");
        }
        const task = payload.tasks?.[0];
        if (!task)
            throw new ProviderFailure("invalid_response", "The backlink provider returned no task.");
        if (task.status_code !== 20000)
            throw new ProviderFailure("provider_error", "The backlink provider rejected the backlink list request.");
        const result = task.result?.[0];
        if (!result || !Array.isArray(result.items))
            throw new ProviderFailure("invalid_response", "The backlink provider returned no backlink list.");
        const items = result.items.flatMap((item) => {
            if (item.type !== "backlink" || typeof item.url_from !== "string" || typeof item.url_to !== "string")
                return [];
            const isLost = item.is_lost === true;
            const lastSeen = dateText(item.last_seen);
            return [{ sourceUrl: item.url_from, targetUrl: item.url_to, anchorText: dateText(item.anchor), follow: typeof item.dofollow === "boolean" ? item.dofollow : null, firstSeen: dateText(item.first_seen), lastSeen, lostAt: isLost ? lastSeen : null, pageRank: numeric(item.page_from_rank), spamScore: numeric(item.backlink_spam_score), isNew: item.is_new === true, isLost }];
        });
        return { provider: this.id, confidence: "PROVIDER_OBSERVED", observedAt: new Date().toISOString(), billedCostUsd: numeric(task.cost), totalCount: numeric(result.total_count) ?? items.length, items };
    }
}
export function configuredDataForSeoBacklinkProvider(request = fetch, overrides) {
    return new DataForSeoBacklinkProvider({ login: overrides?.login ?? process.env.DATAFORSEO_LOGIN, password: overrides?.password ?? process.env.DATAFORSEO_PASSWORD, enabled: overrides?.enabled ?? process.env.DATAFORSEO_BACKLINKS_ENABLED === "true" }, request);
}
