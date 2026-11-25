import { describe, expect, it, vi } from "vitest";
import { DataForSeoCompetitorProvider } from "./dataforseo-competitors.js";

function response(result: Record<string, unknown>, cost = 0.01) {
  return new Response(JSON.stringify({ tasks: [{ status_code: 20000, cost, result: [result] }] }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("DataForSEO competitor adapter", () => {
  it("normalizes discovery and labels estimated domain metrics", async () => {
    const request = vi.fn().mockResolvedValue(response({ total_count: 2, items: [{ domain: "www.rival.example", avg_position: 8.4, intersections: 42, full_domain_metrics: { organic: { count: 1000, etv: 350 }, paid: { count: 14, etv: 7, estimated_paid_traffic_cost: 125 } } }, { domain: "www.example.com", avg_position: 1, intersections: 100, full_domain_metrics: { organic: { count: 2000 } } }] }));
    const provider = new DataForSeoCompetitorProvider({ login: "u", password: "p", enabled: true }, request);
    const result = await provider.discover({ target: "example.com", country: "US", limit: 10 });
    expect(result).toMatchObject({ provider: "dataforseo_labs_competitors_domain", confidence: "PROVIDER_ESTIMATE", billedCostUsd: 0.01, totalCount: 2, items: [{ host: "rival.example", intersections: 42, organicKeywords: 1000, estimatedOrganicTraffic: 350, paidKeywords: 14 }] });
    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    expect(body[0]).toMatchObject({ target: "example.com", location_code: 2840, language_code: "en", item_types: ["organic"], exclude_top_domains: true });
  });

  it("requests target1 competitor keywords that target2 does not rank for", async () => {
    const request = vi.fn().mockResolvedValue(response({ total_count: 1, items: [{ keyword_data: { keyword: "rival opportunity", keyword_info: { search_volume: 700, cpc: 2.3, competition: 0.4 } }, first_domain_serp_element: { rank_group: 4, url: "https://rival.example/page" } }] }));
    const provider = new DataForSeoCompetitorProvider({ login: "u", password: "p", enabled: true }, request);
    const result = await provider.keywordGap({ target: "ours.example", competitor: "rival.example", country: "GB", limit: 100, offset: 0 });
    expect(result).toMatchObject({ provider: "dataforseo_labs_domain_intersection", totalCount: 1, items: [{ keyword: "rival opportunity", searchVolume: 700, competitorPosition: 4, competitorUrl: "https://rival.example/page" }] });
    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    expect(body[0]).toMatchObject({ target1: "rival.example", target2: "ours.example", location_code: 2826, intersections: false, item_types: ["organic"] });
  });
});
