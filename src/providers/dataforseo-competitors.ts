import { ProviderFailure } from "./dataforseo.js";
import type { RankingCountry } from "./dataforseo-rankings.js";

const locationCodes: Record<RankingCountry, number> = { US: 2840, GB: 2826, CA: 2124, AU: 2036, IN: 2356 };
type JsonObject = Record<string, unknown>;
type Task = { status_code?: unknown; status_message?: unknown; cost?: unknown; result?: Array<JsonObject> };
function object(value: unknown): JsonObject { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}; }
function numeric(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function metric(record: JsonObject, key: string): number | null { return numeric(record[key]); }

export type CompetitorEstimate = { host: string; averagePosition: number | null; intersections: number | null; organicKeywords: number | null; estimatedOrganicTraffic: number | null; paidKeywords: number | null; estimatedPaidTraffic: number | null; estimatedPaidTrafficCost: number | null };
export type CompetitorGapKeyword = { keyword: string; searchVolume: number | null; cpc: number | null; competition: number | null; competitorPosition: number | null; competitorUrl: string | null };
export type CompetitorProviderResult<T> = { provider: "dataforseo_labs_competitors_domain" | "dataforseo_labs_domain_intersection"; confidence: "PROVIDER_ESTIMATE"; observedAt: string; billedCostUsd: number | null; totalCount: number; items: T[] };

export class DataForSeoCompetitorProvider {
  readonly id = "dataforseo_labs_competitors" as const;
  constructor(private readonly config: { login?: string; password?: string; enabled: boolean }, private readonly request: typeof fetch = fetch) {}

  async discover(input: { target: string; country: RankingCountry; limit: number }): Promise<CompetitorProviderResult<CompetitorEstimate>> {
    const result = await this.post("/v3/dataforseo_labs/google/competitors_domain/live", { target: input.target, location_code: locationCodes[input.country], language_code: "en", item_types: ["organic"], exclude_top_domains: true, limit: input.limit });
    const items = Array.isArray(result.items) ? result.items : [];
    const competitors = items.flatMap((raw) => {
      const item = object(raw); const host = text(item.domain);
      if (!host) return [];
      const metrics = object(item.full_domain_metrics); const organic = object(metrics.organic); const paid = object(metrics.paid);
      const normalizedHost = host.toLowerCase().replace(/^www\./u, "");
      if (normalizedHost === input.target.toLowerCase().replace(/^www\./u, "")) return [];
      return [{ host: normalizedHost, averagePosition: numeric(item.avg_position), intersections: numeric(item.intersections), organicKeywords: metric(organic, "count"), estimatedOrganicTraffic: metric(organic, "etv"), paidKeywords: metric(paid, "count"), estimatedPaidTraffic: metric(paid, "etv"), estimatedPaidTrafficCost: metric(paid, "estimated_paid_traffic_cost") }];
    });
    return { provider: "dataforseo_labs_competitors_domain", confidence: "PROVIDER_ESTIMATE", observedAt: new Date().toISOString(), billedCostUsd: numeric(this.lastCost), totalCount: numeric(result.total_count) ?? competitors.length, items: competitors };
  }

  async keywordGap(input: { target: string; competitor: string; country: RankingCountry; limit: number; offset: number }): Promise<CompetitorProviderResult<CompetitorGapKeyword>> {
    const result = await this.post("/v3/dataforseo_labs/google/domain_intersection/live", { target1: input.competitor, target2: input.target, location_code: locationCodes[input.country], language_code: "en", intersections: false, item_types: ["organic"], include_serp_info: false, limit: input.limit, offset: input.offset, order_by: ["keyword_data.keyword_info.search_volume,desc"] });
    const items = Array.isArray(result.items) ? result.items : [];
    const gaps = items.flatMap((raw) => {
      const item = object(raw); const keywordData = object(item.keyword_data); const keyword = text(keywordData.keyword);
      if (!keyword) return [];
      const info = object(keywordData.keyword_info); const serp = object(item.first_domain_serp_element);
      return [{ keyword, searchVolume: numeric(info.search_volume), cpc: numeric(info.cpc), competition: numeric(info.competition), competitorPosition: numeric(serp.rank_group), competitorUrl: text(serp.url) }];
    });
    return { provider: "dataforseo_labs_domain_intersection", confidence: "PROVIDER_ESTIMATE", observedAt: new Date().toISOString(), billedCostUsd: numeric(this.lastCost), totalCount: numeric(result.total_count) ?? gaps.length, items: gaps };
  }

  private lastCost: number | null = null;
  private async post(path: string, requestTask: JsonObject): Promise<JsonObject> {
    if (!this.config.enabled || !this.config.login || !this.config.password) throw new ProviderFailure("not_configured", "DataForSEO competitor research is not enabled or service credentials are missing.");
    let response: Response;
    try {
      response = await this.request(`https://api.dataforseo.com${path}`, { method: "POST", headers: { authorization: `Basic ${Buffer.from(`${this.config.login}:${this.config.password}`).toString("base64")}`, "content-type": "application/json" }, body: JSON.stringify([requestTask]), signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") throw new ProviderFailure("timeout", "The competitor research provider did not respond before the request deadline.");
      throw new ProviderFailure("http_error", "The competitor research provider could not be reached.");
    }
    if (!response.ok) throw new ProviderFailure("http_error", `The competitor research provider returned HTTP ${response.status}.`);
    let payload: { tasks?: Task[] };
    try { payload = await response.json() as { tasks?: Task[] }; }
    catch { throw new ProviderFailure("invalid_response", "The competitor research provider returned unreadable results."); }
    const task = payload.tasks?.[0];
    if (!task) throw new ProviderFailure("invalid_response", "The competitor research provider returned no task.");
    if (task.status_code !== 20000) throw new ProviderFailure("provider_error", "The competitor research provider rejected the request.");
    const result = task.result?.[0];
    if (!result) throw new ProviderFailure("invalid_response", "The provider response contained no competitor result.");
    this.lastCost = numeric(task.cost);
    return result;
  }
}

export function configuredDataForSeoCompetitorProvider(request: typeof fetch = fetch, overrides?: { login?: string; password?: string; enabled?: boolean }): DataForSeoCompetitorProvider {
  return new DataForSeoCompetitorProvider({ login: overrides?.login ?? process.env.DATAFORSEO_LOGIN, password: overrides?.password ?? process.env.DATAFORSEO_PASSWORD, enabled: overrides?.enabled ?? process.env.DATAFORSEO_COMPETITORS_ENABLED === "true" }, request);
}
