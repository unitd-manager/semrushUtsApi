import { describe, expect, it, vi } from "vitest";
import { DataForSeoSuggestionProvider } from "./dataforseo-suggestions.js";
describe("DataForSEO keyword suggestion adapter", () => {
    it("normalizes suggestions, difficulty, intent, and keyword trend data", async () => {
        const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ tasks: [{ status_code: 20000, cost: 0.01, result: [{ total_count: 81, items: [{ keyword: "technical seo checklist", keyword_info: { search_volume: 90, cpc: 2.1, competition: 0.34, monthly_searches: [{ year: 2026, month: 9, search_volume: 90 }] }, keyword_properties: { keyword_difficulty: 27, core_keyword: "technical seo" }, search_intent_info: { main_intent: "informational" } }] }] }] }), { status: 200 }));
        const provider = new DataForSeoSuggestionProvider({ login: "account", password: "secret", enabled: true }, request);
        const result = await provider.suggest({ seed: "technical seo", country: "GB", limit: 100 });
        expect(result).toMatchObject({ provider: "dataforseo_labs_keyword_suggestions", confidence: "PROVIDER_ESTIMATE", billedCostUsd: 0.01, totalCount: 81 });
        expect(result.suggestions[0]).toMatchObject({ phrase: "technical seo checklist", searchVolume: 90, difficulty: 27, intent: "informational", cluster: "technical seo", monthlySearches: [{ year: 2026, month: 9, searchVolume: 90 }] });
        expect(request.mock.calls[0][0]).toContain("dataforseo_labs/google/keyword_suggestions/live");
    });
    it("does not request paid data while disabled", async () => {
        const request = vi.fn();
        const provider = new DataForSeoSuggestionProvider({ login: "account", password: "secret", enabled: false }, request);
        await expect(provider.suggest({ seed: "seo basics", country: "IN", limit: 50 })).rejects.toMatchObject({ code: "not_configured" });
        expect(request).not.toHaveBeenCalled();
    });
});
