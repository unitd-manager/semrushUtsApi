import { describe, expect, it } from "vitest";
import { buildOnPageFindings } from "./on-page.js";
const page = { url: "https://example.com/guides/seo", statusCode: 200, title: "Searchlight SEO guide", titleLength: 21, description: "A helpful guide", h1: "SEO guide", indexable: true, wordCount: 620 };
describe("on-page crawl recommendations", () => {
    it("returns no issues when the stored fields satisfy the selected checks", () => {
        expect(buildOnPageFindings({ ...page, title: "SEO guide for teams", h1: "SEO guide for teams" }, "SEO guide")).toEqual([]);
    });
    it("identifies only evidenced omissions and labels text matching as a heuristic", () => {
        const result = buildOnPageFindings({ ...page, statusCode: 404, indexable: false, title: null, description: null, h1: null, wordCount: 80 }, "technical seo");
        expect(result.map((finding) => finding.code)).toEqual(["http_status", "indexability", "missing_title", "missing_description", "missing_h1", "content_length"]);
        expect(result.find((finding) => finding.code === "content_length")?.description).toContain("no universal ideal word count");
    });
});
