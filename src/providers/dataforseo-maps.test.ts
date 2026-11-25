import { describe, expect, it, vi } from "vitest";
import { DataForSeoMapsProvider } from "./dataforseo-maps.js";

const points = ["NW", "N", "NE", "W", "Center", "E", "SW", "S", "SE"].map((label, index) => ({ label, coordinate: `40.${index},-73.9,17z` }));

describe("DataForSEO Google Maps ranking adapter", () => {
  it("matches the project host at each grid point and retains observed listing data and cost", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ tasks: points.map((_, index) => ({ status_code: 20000, cost: 0.002, result: [{ datetime: "2026-11-01 12:00:00 +00:00", items: index === 4 ? [{ type: "maps_search", rank_absolute: 3, domain: "www.example.com", title: "Example Shop", url: "https://example.com/store", place_id: "abc", rating: { value: 4.8, votes_count: 74 } }] : [{ type: "maps_search", rank_absolute: 1, domain: "other.example" }] }] })) }), { status: 200 }));
    const result = await new DataForSeoMapsProvider({ login: "account", password: "secret", enabled: true }, request).check({ keywords: ["coffee shop"], points, targetHost: "example.com" });
    expect(result.billedCostUsd).toBeCloseTo(0.018);
    expect(result.observations).toHaveLength(9);
    expect(result.observations[4]).toMatchObject({ position: 3, listingName: "Example Shop", placeId: "abc", rating: 4.8, reviews: 74 });
    expect(result.observations[0]?.position).toBeNull();
    expect(request.mock.calls[0]?.[0]).toContain("serp/google/maps/live/advanced");
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toHaveLength(9);
  });

  it("refuses disabled provider calls and invalid grid sizes before network access", async () => {
    const request = vi.fn<typeof fetch>();
    const disabled = new DataForSeoMapsProvider({ login: "account", password: "secret", enabled: false }, request);
    await expect(disabled.check({ keywords: ["coffee"], points, targetHost: "example.com" })).rejects.toMatchObject({ code: "not_configured" });
    const enabled = new DataForSeoMapsProvider({ login: "account", password: "secret", enabled: true }, request);
    await expect(enabled.check({ keywords: ["coffee"], points: points.slice(0, 2), targetHost: "example.com" })).rejects.toMatchObject({ code: "invalid_response" });
    expect(request).not.toHaveBeenCalled();
  });
});
