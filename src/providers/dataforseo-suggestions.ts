import { ProviderFailure } from "./dataforseo.js";
import type { RankingCountry } from "./dataforseo-rankings.js";

const locationCodes: Record<RankingCountry, number> = { US: 2840, GB: 2826, CA: 2124, AU: 2036, IN: 2356 };
type SuggestionItem = { keyword?: unknown; keyword_info?: { search_volume?: unknown; cpc?: unknown; competition?: unknown; monthly_searches?: unknown }; keyword_properties?: { keyword_difficulty?: unknown; core_keyword?: unknown }; search_intent_info?: { main_intent?: unknown } };
type SuggestionTask = { status_code?: unknown; cost?: unknown; result?: Array<{ total_count?: unknown; items?: unknown }> };
export type KeywordSuggestion = { phrase: string; searchVolume: number | null; cpc: number | null; competition: number | null; difficulty: number | null; intent: string | null; cluster: string | null; monthlySearches: { year: number; month: number; searchVolume: number }[] };
export type SuggestionResult = { provider: "dataforseo_labs_keyword_suggestions"; confidence: "PROVIDER_ESTIMATE"; observedAt: string; billedCostUsd: number | null; totalCount: number; suggestions: KeywordSuggestion[] };
function numeric(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }

export class DataForSeoSuggestionProvider {
  readonly id = "dataforseo_labs_keyword_suggestions" as const;
  constructor(private readonly config: { login?: string; password?: string; enabled: boolean }, private readonly request: typeof fetch = fetch) {}
  async suggest(input: { seed: string; country: RankingCountry; limit: number }): Promise<SuggestionResult> {
    if (!this.config.enabled || !this.config.login || !this.config.password) throw new ProviderFailure("not_configured", "DataForSEO keyword suggestions are not enabled or service credentials are missing.");
    let response: Response;
    try {
      response = await this.request("https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_suggestions/live", {
        method: "POST", headers: { authorization: `Basic ${Buffer.from(`${this.config.login}:${this.config.password}`).toString("base64")}`, "content-type": "application/json" },
        body: JSON.stringify([{ keyword: input.seed, location_code: locationCodes[input.country], language_code: "en", include_serp_info: false, include_seed_keyword: true, limit: input.limit, order_by: ["keyword_info.search_volume,desc"] }]),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") throw new ProviderFailure("timeout", "The keyword suggestion provider did not respond before the request deadline.");
      throw new ProviderFailure("http_error", "The keyword suggestion provider could not be reached.");
    }
    if (!response.ok) throw new ProviderFailure("http_error", `The keyword suggestion provider returned HTTP ${response.status}.`);
    let payload: { tasks?: SuggestionTask[] };
    try { payload = await response.json() as { tasks?: SuggestionTask[] }; }
    catch { throw new ProviderFailure("invalid_response", "The keyword suggestion provider returned unreadable results."); }
    const task = payload.tasks?.[0];
    if (!task) throw new ProviderFailure("invalid_response", "The keyword suggestion provider returned no task.");
    if (task.status_code !== 20000) throw new ProviderFailure("provider_error", "The keyword suggestion provider rejected the request.");
    const result = task.result?.[0];
    if (!result || !Array.isArray(result.items)) throw new ProviderFailure("invalid_response", "The provider response did not contain suggestion records.");
    const suggestions = (result.items as SuggestionItem[]).flatMap((item) => {
      if (typeof item.keyword !== "string") return [];
      const monthlySearches = Array.isArray(item.keyword_info?.monthly_searches) ? item.keyword_info!.monthly_searches.flatMap((month) => {
        if (!month || typeof month !== "object") return [];
        const row = month as { year?: unknown; month?: unknown; search_volume?: unknown };
        if (typeof row.year !== "number" || typeof row.month !== "number" || typeof row.search_volume !== "number") return [];
        return [{ year: row.year, month: row.month, searchVolume: row.search_volume }];
      }) : [];
      const intent = item.search_intent_info?.main_intent;
      return [{ phrase: item.keyword, searchVolume: numeric(item.keyword_info?.search_volume), cpc: numeric(item.keyword_info?.cpc), competition: numeric(item.keyword_info?.competition), difficulty: numeric(item.keyword_properties?.keyword_difficulty), intent: typeof intent === "string" ? intent : null, cluster: typeof item.keyword_properties?.core_keyword === "string" ? item.keyword_properties.core_keyword : null, monthlySearches }];
    });
    return { provider: "dataforseo_labs_keyword_suggestions", confidence: "PROVIDER_ESTIMATE", observedAt: new Date().toISOString(), billedCostUsd: numeric(task.cost), totalCount: numeric(result.total_count) ?? suggestions.length, suggestions };
  }
}

export function configuredDataForSeoSuggestionProvider(request: typeof fetch = fetch, overrides?: { login?: string; password?: string; enabled?: boolean }): DataForSeoSuggestionProvider {
  return new DataForSeoSuggestionProvider({ login: overrides?.login ?? process.env.DATAFORSEO_LOGIN, password: overrides?.password ?? process.env.DATAFORSEO_PASSWORD, enabled: overrides?.enabled ?? process.env.DATAFORSEO_KEYWORD_RESEARCH_ENABLED === "true" }, request);
}
