import { describe, expect, it, vi } from "vitest";
import { DataForSeoRankingProvider } from "./dataforseo-rankings.js";
describe("DataForSEO organic ranking adapter", () => {
    it("maps target-domain organic positions and records missing rank as null", async () => {
        const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ tasks: [
                { status_code: 20000, cost: 0.002, result: [{ items: [{ type: "organic", domain: "other.test", rank_absolute: 1, url: "https://other.test" }, { type: "organic", domain: "www.example.com", rank_absolute: 4, url: "https://www.example.com/page" }] }] },
                { status_code: 20000, cost: 0.002, result: [{ items: [{ type: "organic", domain: "other.test", rank_absolute: 1, url: "https://other.test" }] }] },
            ] }), { status: 200 }));
        const provider = new DataForSeoRankingProvider({ login: "account", password: "secret", enabled: true }, request);
        const result = await provider.check({ keywords: ["seo tool", "site audit"], country: "US", device: "mobile", targetHost: "example.com" });
        expect(result.confidence).toBe("PROVIDER_OBSERVED");
        expect(result.billedCostUsd).toBe(0.004);
        expect(result.observations.map((row) => [row.position, row.url])).toEqual([[4, "https://www.example.com/page"], [null, null]]);
        expect(request.mock.calls[0][0]).toContain("serp/google/organic/live/advanced");
        expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject([{ device: "mobile", depth: 10, location_code: 2840 }, { device: "mobile", depth: 10, location_code: 2840 }]);
    });
    it("does not make a paid request when disabled", async () => {
        const request = vi.fn();
        const provider = new DataForSeoRankingProvider({ login: "account", password: "secret", enabled: false }, request);
        await expect(provider.check({ keywords: ["query"], country: "GB", device: "desktop", targetHost: "example.com" })).rejects.toMatchObject({ code: "not_configured" });
        expect(request).not.toHaveBeenCalled();
    });
});
