import { describe, expect, it, vi } from "vitest";
import { DataForSeoBacklinkProvider } from "./dataforseo-backlinks.js";
describe("DataForSEO backlink summary adapter", () => {
    it("normalizes index counts and preserves reported cost and spam indicators", async () => {
        const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ tasks: [{ status_code: 20000, cost: 0.02, result: [{ target: "example.com", rank: 371, backlinks: 41245, referring_domains: 12372, referring_main_domains: 11438, referring_ips: 10401, referring_pages: 32010, broken_backlinks: 209, backlinks_spam_score: 8, first_seen: "2020-01-18 11:50:58 +00:00", lost_date: null, crawled_pages: 2150, info: { target_spam_score: 0 } }] }] }), { status: 200 }));
        const provider = new DataForSeoBacklinkProvider({ login: "account", password: "secret", enabled: true }, request);
        const result = await provider.summarize("example.com");
        expect(result).toMatchObject({ provider: "dataforseo_backlinks", confidence: "PROVIDER_OBSERVED", billedCostUsd: 0.02, summary: { targetRank: 371, backlinks: 41245, referringDomains: 12372, referringIps: 10401, brokenBacklinks: 209, backlinkSpamScore: 8, targetSpamScore: 0, lostDate: null } });
        expect(request.mock.calls[0][0]).toContain("backlinks/summary/live");
        expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject([{ target: "example.com", include_subdomains: true, exclude_internal_backlinks: true, backlinks_status_type: "all", rank_scale: "one_thousand" }]);
    });
    it("does not make a paid request while disabled", async () => {
        const request = vi.fn();
        const provider = new DataForSeoBacklinkProvider({ login: "account", password: "secret", enabled: false }, request);
        await expect(provider.summarize("example.com")).rejects.toMatchObject({ code: "not_configured" });
        expect(request).not.toHaveBeenCalled();
    });
    it("normalizes live/lost backlink rows and requests a bounded provider page", async () => {
        const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ tasks: [{ status_code: 20000, cost: 0.02, result: [{ total_count: 2000, items: [{ type: "backlink", url_from: "https://referrer.test/post", url_to: "https://example.com/page", anchor: "example guide", dofollow: false, first_seen: "2026-01-04 00:00:00 +00:00", last_seen: "2026-02-01 00:00:00 +00:00", is_new: false, is_lost: true, page_from_rank: 420, backlink_spam_score: 3 }] }] }] }), { status: 200 }));
        const provider = new DataForSeoBacklinkProvider({ login: "account", password: "secret", enabled: true }, request);
        const result = await provider.list({ target: "example.com", limit: 100, offset: 100, status: "lost" });
        expect(result).toMatchObject({ totalCount: 2000, billedCostUsd: 0.02, items: [{ sourceUrl: "https://referrer.test/post", targetUrl: "https://example.com/page", anchorText: "example guide", follow: false, lostAt: "2026-02-01 00:00:00 +00:00", pageRank: 420, spamScore: 3, isLost: true }] });
        expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject([{ target: "example.com", backlinks_status_type: "lost", offset: 100, limit: 100 }]);
    });
});
