import { describe, expect, it, vi } from "vitest";
import { DataForSeoKeywordProvider, ProviderFailure } from "./dataforseo.js";

describe("DataForSEO keyword adapter", () => {
  it("normalizes keyword metrics and marks volume as a provider estimate", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ tasks: [{ status_code: 20000, cost: 0.01, result: [{ keyword: "technical seo", search_volume: 720, cpc: 4.2, competition_index: 64, monthly_searches: [{ year: 2026, month: 9, search_volume: 720 }] }] }] }), { status: 200 }));
    const provider = new DataForSeoKeywordProvider({ login: "account", password: "secret", enabled: true }, request);
    const result = await provider.research({ keywords: ["technical seo"], country: "US" });
    expect(result.provider).toBe("dataforseo");
    expect(result.confidence).toBe("PROVIDER_ESTIMATE");
    expect(result.billedCostUsd).toBe(0.01);
    expect(result.keywords[0]).toMatchObject({ phrase: "technical seo", searchVolume: 720, cpc: 4.2, competition: 64, monthlySearches: [{ year: 2026, month: 9, searchVolume: 720 }] });
    expect(request.mock.calls[0][0]).toContain("search_volume/live");
  });

  it("does not make a network request until explicitly enabled", async () => {
    const request = vi.fn<typeof fetch>();
    const provider = new DataForSeoKeywordProvider({ login: "account", password: "secret", enabled: false }, request);
    await expect(provider.research({ keywords: ["query"], country: "US" })).rejects.toMatchObject({ code: "not_configured" });
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects a provider task error without turning it into metrics", async () => {
    const provider = new DataForSeoKeywordProvider({ login: "account", password: "secret", enabled: true }, vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ tasks: [{ status_code: 40501, status_message: "error" }] }), { status: 200 })));
    await expect(provider.research({ keywords: ["query"], country: "GB" })).rejects.toBeInstanceOf(ProviderFailure);
  });

  it("classifies the provider HTTP 402 as insufficient account funds without leaking the response", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status_code: 40200, status_message: "Payment required" }), { status: 402 }));
    const provider = new DataForSeoKeywordProvider({ login: "account", password: "secret", enabled: true }, request);
    await expect(provider.research({ keywords: ["query"], country: "US" })).rejects.toMatchObject({ code: "insufficient_funds", details: { httpStatus: 402, providerStatus: 40200 }, message: expect.stringContaining("recharged") });
    expect(request.mock.calls[0][1]?.headers).toMatchObject({ authorization: expect.stringMatching(/^Basic /u) });
  });

  it("uses only the account endpoint for a non-billable health check and classifies a negative balance", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ money: { balance: -0.05 } }] }] }), { status: 200 }));
    const provider = new DataForSeoKeywordProvider({ login: "account", password: "secret", enabled: true }, request);
    const health = await provider.healthCheck();
    expect(request.mock.calls[0][0]).toContain("appendix/user_data");
    expect(health).toMatchObject({ status: "insufficient_funds", credentialsValid: true, balance: -0.05 });
    expect(JSON.stringify(health)).not.toContain("secret");
  });

  it("distinguishes temporary account suspension from billing restriction", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ tasks: [{ status_code: 40201, status_message: "paused" }] }), { status: 200 }));
    const health = await new DataForSeoKeywordProvider({ login: "account", password: "secret", enabled: true }, request).healthCheck();
    expect(health.status).toBe("account_suspended");
    expect(health.message).toContain("provider support");
  });
});
