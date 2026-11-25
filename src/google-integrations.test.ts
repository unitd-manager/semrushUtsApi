import { describe, expect, it, vi } from "vitest";
import { authorizedGoogleFetch, getGoogleReport, GoogleIntegrationFailure, listGoogleAccounts, listGoogleBusinessLocations, listGoogleBusinessReviews, parseGoogleJson, refreshGoogleTokens, type GoogleConfig } from "./google-integrations.js";

const config: GoogleConfig = { id: "google-analytics", clientId: "client", clientSecret: "secret", redirectUri: "http://localhost/callback", scopes: ["analytics.readonly"] };
const expired = { accessToken: "old-access", refreshToken: "refresh-secret", expiresAt: 1, scope: "analytics.readonly", tokenType: "Bearer", accountId: "properties/123" };

describe("Google API client", () => {
  it("supports exact Search Console dimension filters for page-scoped query reports", async () => {
    const gsc: GoogleConfig = { id: "google-search-console", clientId: "client", clientSecret: "secret", redirectUri: "http://localhost/callback", scopes: ["webmasters.readonly"] };
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ rows: [{ keys: ["example query"], clicks: 4, impressions: 20, ctr: 0.2, position: 3 }] }), { status: 200 }));
    const result = await getGoogleReport(gsc, { ...expired, expiresAt: Date.now() + 3600_000, accountId: "sc-domain:example.com" }, { startDate: "2026-10-01", endDate: "2026-10-28", dimensions: ["query"], dimensionFilters: [{ dimension: "page", operator: "equals", expression: "https://example.com/page/" }] }, request);
    expect(result.report).toMatchObject({ rows: [{ keys: ["example query"], clicks: 4 }] });
    const body = JSON.parse(String(request.mock.calls[0][1]?.body));
    expect(body.dimensionFilterGroups).toEqual([{ groupType: "and", filters: [{ dimension: "page", operator: "equals", expression: "https://example.com/page/" }] }]);
  });
  it("renews expired access tokens using the stored refresh token", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ access_token: "new-access", expires_in: 1800, token_type: "Bearer" }), { status: 200 }));
    const result = await refreshGoogleTokens(config, expired, request);
    expect(result.accessToken).toBe("new-access");
    expect(result.refreshToken).toBe(expired.refreshToken);
    expect(request.mock.calls[0][0]).toContain("oauth2.googleapis.com/token");
  });

  it("classifies Google permission denial without exposing its response body", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED", message: "private diagnostic" } }), { status: 403 }));
    const result = await authorizedGoogleFetch(config, { ...expired, expiresAt: Date.now() + 3600_000 }, "https://example.test/report", {}, request);
    await expect(parseGoogleJson(result.response)).rejects.toMatchObject({ code: "permission_denied", status: 403 });
    await expect(authorizedGoogleFetch(config, { ...expired, refreshToken: null }, "https://example.test/report", {}, vi.fn<typeof fetch>())).rejects.toBeInstanceOf(GoogleIntegrationFailure);
  });
});

describe("Google Business Profile read integration", () => {
  const gbp: GoogleConfig = { id: "google-business-profile", clientId: "client", clientSecret: "secret", redirectUri: "http://localhost/callback", scopes: ["business.manage"] };
  const active = { accessToken: "active", refreshToken: "refresh", expiresAt: Date.now() + 3600_000, scope: "business.manage", tokenType: "Bearer", accountId: "accounts/123", accountName: "Acme" };

  it("lists accessible profile accounts for OAuth account selection", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ accounts: [{ name: "accounts/123", accountName: "Acme Group", type: "LOCATION_GROUP" }] }), { status: 200 }));
    const result = await listGoogleAccounts(gbp, active, request);
    expect(result.accounts).toEqual([{ id: "accounts/123", name: "Acme Group", detail: "LOCATION_GROUP" }]);
  });

  it("paginates locations and normalizes private account paths and contact fields", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ locations: [{ name: "locations/456", title: "Acme Store", phoneNumbers: { primaryPhone: "+1 555 0100" }, websiteUri: "https://example.com" }], nextPageToken: "page-2" }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ locations: [{ name: "locations/789", title: "Acme Annex" }] }), { status: 200 }));
    const result = await listGoogleBusinessLocations(gbp, active, request);
    expect(result.locations.map((location) => location.name)).toEqual(["accounts/123/locations/456", "accounts/123/locations/789"]);
    expect(result.locations[0]).toMatchObject({ title: "Acme Store", primaryPhone: "+1 555 0100", websiteUri: "https://example.com" });
    expect(request.mock.calls[1]?.[0]).toContain("pageToken=page-2");
  });

  it("maps review ratings and refuses a location owned by another account", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ averageRating: 4.5, totalReviewCount: 11, reviews: [{ reviewId: "review-1", starRating: "FIVE", comment: "Great", createTime: "2026-10-01T12:00:00Z", reviewer: { displayName: "Reviewer" }, reviewReply: { comment: "Thanks" } }] }), { status: 200 }));
    const result = await listGoogleBusinessReviews(gbp, active, "accounts/123/locations/456", request);
    expect(result).toMatchObject({ averageRating: 4.5, totalReviewCount: 11, reviews: [{ reviewId: "review-1", rating: 5, text: "Great", reviewerName: "Reviewer", reply: "Thanks" }] });
    await expect(listGoogleBusinessReviews(gbp, active, "accounts/999/locations/456", request)).rejects.toMatchObject({ code: "location_not_accessible", status: 403 });
  });
});
