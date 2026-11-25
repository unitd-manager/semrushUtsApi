export type KeywordQuery = { phrase: string; searchVolume: number | null; cpc: number | null; competition: number | null; monthlySearches: { year: number; month: number; searchVolume: number }[] };
export type KeywordResearchResult = { provider: "dataforseo"; observedAt: string; confidence: "PROVIDER_ESTIMATE"; billedCostUsd: number | null; keywords: KeywordQuery[] };
export type KeywordResearchInput = { keywords: string[]; country: "US" | "GB" | "CA" | "AU" | "IN" };
export type ProviderFailureCode = "not_configured" | "http_error" | "provider_error" | "invalid_response" | "timeout" | "insufficient_funds" | "credentials_invalid" | "account_suspended" | "rate_limited";

export class ProviderFailure extends Error {
  constructor(public readonly code: ProviderFailureCode, message: string, public readonly details: { httpStatus?: number; providerStatus?: number; retryable?: boolean } = {}) { super(message); this.name = "ProviderFailure"; }
}

export interface KeywordResearchProvider {
  readonly id: "dataforseo" | "google-ads";
  research(input: KeywordResearchInput): Promise<KeywordResearchResult>;
}

const locationCodes: Record<KeywordResearchInput["country"], number> = { US: 2840, GB: 2826, CA: 2124, AU: 2036, IN: 2356 };

type DataForSeoItem = { keyword?: unknown; search_volume?: unknown; cpc?: unknown; competition_index?: unknown; monthly_searches?: unknown };
type DataForSeoPayload = { tasks?: Array<{ status_code?: number; status_message?: string; cost?: number; result?: DataForSeoItem[] }> };

function numeric(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }

export class DataForSeoKeywordProvider implements KeywordResearchProvider {
  readonly id = "dataforseo" as const;
  constructor(private readonly config: { login?: string; password?: string; enabled: boolean }, private readonly request: typeof fetch = fetch) {}

  async research(input: KeywordResearchInput): Promise<KeywordResearchResult> {
    if (!this.config.enabled || !this.config.login || !this.config.password) throw new ProviderFailure("not_configured", "DataForSEO keyword research is not enabled or its service credentials are missing.");
    const credentials = Buffer.from(`${this.config.login}:${this.config.password}`).toString("base64");
    let response: Response;
    try {
      response = await this.request("https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live", {
        method: "POST",
        headers: { authorization: `Basic ${credentials}`, "content-type": "application/json" },
        body: JSON.stringify([{ keywords: input.keywords, location_code: locationCodes[input.country], language_code: "en", include_adult_keywords: false }]),
        signal: AbortSignal.timeout(25_000),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") throw new ProviderFailure("timeout", "The keyword data provider did not respond before the request deadline.");
      throw new ProviderFailure("http_error", "The keyword data provider could not be reached.");
    }
    if (!response.ok) throw await classifyHttpFailure(response);
    let payload: DataForSeoPayload;
    try { payload = await response.json() as DataForSeoPayload; }
    catch { throw new ProviderFailure("invalid_response", "The keyword data provider returned an unreadable response."); }
    const task = payload.tasks?.[0];
    if (!task) throw new ProviderFailure("invalid_response", "The keyword data provider returned no task result.");
    if (task.status_code !== 20000) throw classifyProviderFailure(task.status_code);
    const items = task.result;
    if (!Array.isArray(items)) throw new ProviderFailure("invalid_response", "The provider response did not contain keyword metrics.");
    const observedAt = new Date().toISOString();
    return {
      provider: this.id,
      observedAt,
      confidence: "PROVIDER_ESTIMATE",
      billedCostUsd: numeric(task.cost),
      keywords: items.flatMap((item) => {
        const phrase = typeof item.keyword === "string" ? item.keyword : null;
        if (!phrase) return [];
        const monthly = Array.isArray(item.monthly_searches) ? item.monthly_searches.flatMap((month) => {
          if (!month || typeof month !== "object") return [];
          const row = month as { year?: unknown; month?: unknown; search_volume?: unknown };
          if (typeof row.year !== "number" || typeof row.month !== "number" || typeof row.search_volume !== "number") return [];
          return [{ year: row.year, month: row.month, searchVolume: row.search_volume }];
        }) : [];
        return [{ phrase, searchVolume: numeric(item.search_volume), cpc: numeric(item.cpc), competition: numeric(item.competition_index), monthlySearches: monthly }];
      }),
    };
  }

  async healthCheck(): Promise<{ provider: "dataforseo"; status: "ready" | "insufficient_funds" | "credentials_invalid" | "account_suspended" | "unavailable" | "not_configured"; credentialsValid: boolean; balance: number | null; checkedAt: string; message: string }> {
    const checkedAt = new Date().toISOString();
    if (!this.config.enabled || !this.config.login || !this.config.password) return { provider: this.id, status: "not_configured", credentialsValid: false, balance: null, checkedAt, message: "DataForSEO keyword research is not enabled or its credentials are missing." };
    const credentials = Buffer.from(`${this.config.login}:${this.config.password}`).toString("base64");
    let response: Response;
    try { response = await this.request("https://api.dataforseo.com/v3/appendix/user_data", { headers: { authorization: `Basic ${credentials}`, accept: "application/json" }, signal: AbortSignal.timeout(12_000) }); }
    catch (error) { return { provider: this.id, status: "unavailable", credentialsValid: false, balance: null, checkedAt, message: error instanceof Error && error.name === "TimeoutError" ? "DataForSEO account status request timed out." : "DataForSEO account status could not be reached." }; }
    let payload: { status_code?: number; tasks?: Array<{ status_code?: number; status_message?: string; result?: Array<{ money?: { balance?: unknown } }> }> } = {};
    try { payload = await response.json() as typeof payload; } catch { return { provider: this.id, status: "unavailable", credentialsValid: false, balance: null, checkedAt, message: "DataForSEO returned an unreadable account status." }; }
    const task = payload.tasks?.[0];
    const code = task?.status_code ?? payload.status_code;
    if (!response.ok || code === 40200 || response.status === 402) return { provider: this.id, status: "insufficient_funds", credentialsValid: response.status !== 401, balance: null, checkedAt, message: "DataForSEO reports that the account balance must be recharged." };
    if (code === 40201) return { provider: this.id, status: "account_suspended", credentialsValid: true, balance: null, checkedAt, message: "DataForSEO has temporarily paused this account; contact provider support." };
    if (response.status === 401 || code === 40100) return { provider: this.id, status: "credentials_invalid", credentialsValid: false, balance: null, checkedAt, message: "DataForSEO rejected the API credentials." };
    if (code !== 20000) return { provider: this.id, status: "unavailable", credentialsValid: true, balance: null, checkedAt, message: "DataForSEO account status is unavailable." };
    const money = task?.result?.[0]?.money;
    const balance = numeric(money?.balance);
    const status = balance !== null && balance < 0 ? "insufficient_funds" : "ready";
    return { provider: this.id, status, credentialsValid: true, balance, checkedAt, message: status === "ready" ? "DataForSEO credentials are valid and the account balance is non-negative." : "DataForSEO credentials are valid, but the account balance must be recharged." };
  }
}

async function classifyHttpFailure(response: Response): Promise<ProviderFailure> {
  let status: number | undefined;
  try { const payload = await response.clone().json() as { status_code?: unknown; tasks?: Array<{ status_code?: unknown }> }; const value = payload.tasks?.[0]?.status_code ?? payload.status_code; status = typeof value === "number" ? value : undefined; } catch { /* provider may return a non-JSON HTTP error */ }
  if (response.status === 401) return new ProviderFailure("credentials_invalid", "The keyword provider rejected the configured credentials.", { httpStatus: 401, providerStatus: status });
  if (response.status === 402 || status === 40200) return new ProviderFailure("insufficient_funds", "DataForSEO returned HTTP 402: the account cannot be billed until its balance is recharged.", { httpStatus: response.status, providerStatus: status, retryable: false });
  if (status === 40201) return new ProviderFailure("account_suspended", "DataForSEO temporarily paused this account; contact provider support.", { httpStatus: response.status, providerStatus: status, retryable: false });
  if (response.status === 429) return new ProviderFailure("rate_limited", "The keyword data provider rate limit was reached.", { httpStatus: 429, providerStatus: status, retryable: true });
  return new ProviderFailure("http_error", `The keyword data provider returned HTTP ${response.status}.`, { httpStatus: response.status, providerStatus: status, retryable: response.status >= 500 });
}

function classifyProviderFailure(status?: number): ProviderFailure {
  if (status === 40200) return new ProviderFailure("insufficient_funds", "DataForSEO returned HTTP 402: the account cannot be billed until its balance is recharged.", { providerStatus: status, retryable: false });
  if (status === 40201) return new ProviderFailure("account_suspended", "DataForSEO temporarily paused this account; contact provider support.", { providerStatus: status, retryable: false });
  if (status === 40100 || status === 40101 || status === 40104) return new ProviderFailure("credentials_invalid", "DataForSEO rejected or requires verification for the configured credentials.", { providerStatus: status, retryable: false });
  return new ProviderFailure("provider_error", `The keyword data provider rejected this request (task status ${typeof status === "number" ? status : "unknown"}).`, { providerStatus: status, retryable: false });
}

export function configuredDataForSeoKeywordProvider(request: typeof fetch = fetch, overrides?: { login?: string; password?: string; enabled?: boolean }): DataForSeoKeywordProvider {
  return new DataForSeoKeywordProvider({ login: overrides?.login ?? process.env.DATAFORSEO_LOGIN, password: overrides?.password ?? process.env.DATAFORSEO_PASSWORD, enabled: overrides?.enabled ?? process.env.DATAFORSEO_KEYWORD_RESEARCH_ENABLED === "true" }, request);
}
