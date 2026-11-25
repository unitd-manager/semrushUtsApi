import { ProviderFailure } from "./dataforseo.js";

export type TrafficEstimate = { target: string; locationCode: number; languageCode: string; organic: { etv: number | null; count: number | null }; paid: { etv: number | null; count: number | null }; featuredSnippet: { etv: number | null; count: number | null }; localPack: { etv: number | null; count: number | null }; observedAt: string; costUsd: number | null };
type TrafficMetrics = Record<string, { etv?: unknown; count?: unknown } | undefined>;
const locations: Record<string, number> = { US: 2840, GB: 2826, CA: 2124, AU: 2036, IN: 2356 };
const numberOrNull = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;

export class DataForSeoTrafficProvider {
  constructor(private readonly config: { login?: string; password?: string; enabled: boolean }, private readonly request: typeof fetch = fetch) {}
  async estimate(input: { target: string; country: keyof typeof locations }): Promise<TrafficEstimate> {
    if (!this.config.enabled || !this.config.login || !this.config.password) throw new ProviderFailure("not_configured", "DataForSEO paid traffic estimates are not enabled or credentials are missing.");
    const target = input.target.toLowerCase().replace(/^https?:\/\//u, "").replace(/^www\./u, "").split(/[/?#]/u)[0] ?? "";
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(target)) throw new ProviderFailure("invalid_response", "A valid domain is required for traffic estimation.");
    let response: Response;
    try { response = await this.request("https://api.dataforseo.com/v3/dataforseo_labs/google/domain_rank_overview/live", { method: "POST", headers: { authorization: `Basic ${Buffer.from(`${this.config.login}:${this.config.password}`).toString("base64")}`, "content-type": "application/json" }, body: JSON.stringify([{ target, location_code: locations[input.country], language_code: "en" }]), signal: AbortSignal.timeout(30_000) }); }
    catch (error) { throw new ProviderFailure(error instanceof Error && error.name === "TimeoutError" ? "timeout" : "http_error", "DataForSEO traffic estimates could not be reached."); }
    if (!response.ok) throw new ProviderFailure(response.status === 401 ? "credentials_invalid" : response.status === 402 ? "insufficient_funds" : "http_error", `DataForSEO returned HTTP ${response.status}.`);
    let payload: { tasks?: Array<{ status_code?: number; cost?: number; result?: Array<{ datetime?: string; metrics?: TrafficMetrics }> }> };
    try { payload = await response.json() as typeof payload; } catch { throw new ProviderFailure("invalid_response", "DataForSEO returned unreadable traffic data."); }
    const task = payload.tasks?.[0]; const result = task?.result?.[0];
    if (payload.tasks?.length !== 1 || task?.status_code !== 20000 || !result?.metrics) throw new ProviderFailure("provider_error", "DataForSEO returned no domain traffic overview for this request.");
    const metric = (name: string) => ({ etv: numberOrNull(result.metrics?.[name]?.etv), count: numberOrNull(result.metrics?.[name]?.count) });
    return { target, locationCode: locations[input.country], languageCode: "en", organic: metric("organic"), paid: metric("paid"), featuredSnippet: metric("featured_snippet"), localPack: metric("local_pack"), observedAt: typeof result.datetime === "string" && Number.isFinite(Date.parse(result.datetime)) ? new Date(result.datetime).toISOString() : new Date().toISOString(), costUsd: numberOrNull(task.cost) };
  }
}

export function configuredDataForSeoTrafficProvider(request: typeof fetch = fetch, overrides?: { login?: string; password?: string; enabled?: boolean }) { return new DataForSeoTrafficProvider({ login: overrides?.login ?? process.env.DATAFORSEO_LOGIN, password: overrides?.password ?? process.env.DATAFORSEO_PASSWORD, enabled: overrides?.enabled ?? process.env.DATAFORSEO_TRAFFIC_ENABLED === "true" }, request); }
