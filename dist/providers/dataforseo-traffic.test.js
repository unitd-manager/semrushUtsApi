import { describe, expect, it, vi } from "vitest";
import { DataForSeoTrafficProvider } from "./dataforseo-traffic.js";
describe("DataForSEO traffic overview", () => {
    it("maps organic and paid estimates with cost and market attribution", async () => {
        const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ tasks: [{ status_code: 20000, cost: 0.02, result: [{ datetime: "2026-11-02T10:00:00Z", metrics: { organic: { etv: 1450, count: 230 }, paid: { etv: 75, count: 12 }, featured_snippet: { etv: 4, count: 1 }, local_pack: { etv: 2, count: 1 } } }] }] }), { status: 200 }));
        const result = await new DataForSeoTrafficProvider({ login: "l", password: "p", enabled: true }, request).estimate({ target: "https://www.example.com/path", country: "US" });
        expect(result).toMatchObject({ target: "example.com", locationCode: 2840, organic: { etv: 1450, count: 230 }, paid: { etv: 75, count: 12 }, costUsd: 0.02 });
        expect(request.mock.calls[0][0]).toContain("domain_rank_overview/live");
    });
    it("refuses malformed domains and disabled billing configuration", async () => {
        const provider = new DataForSeoTrafficProvider({ login: "l", password: "p", enabled: false });
        await expect(provider.estimate({ target: "example.com", country: "US" })).rejects.toMatchObject({ code: "not_configured" });
        await expect(new DataForSeoTrafficProvider({ login: "l", password: "p", enabled: true }).estimate({ target: "localhost", country: "US" })).rejects.toMatchObject({ code: "invalid_response" });
    });
});
