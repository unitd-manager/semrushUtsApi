import { describe, expect, it } from "vitest";
import { assertSeoFixTransition, canReviewSeoFix, classifySeoFixRisk, safeHttpsUrl, seoFixCategory, validateSeoFixValue } from "./seo-fix-center.js";
describe("SEO Fix Center policy and validation", () => {
    it("maps issue families to the standalone dashboard categories", () => {
        expect(seoFixCategory("MISSING_TITLE")).toBe("Metadata");
        expect(seoFixCategory("BROKEN_INTERNAL_LINK")).toBe("Internal Links");
        expect(seoFixCategory("MALFORMED_JSON_LD")).toBe("Structured Data");
    });
    it("classifies changes by implementation impact and restricts high risk review", () => {
        expect(classifySeoFixRisk("MISSING_TITLE")).toBe("LOW");
        expect(classifySeoFixRisk("DUPLICATE_TITLE")).toBe("MEDIUM");
        expect(classifySeoFixRisk("REDIRECT_CHAIN")).toBe("HIGH");
        expect(canReviewSeoFix("MANAGER", "HIGH")).toBe(false);
        expect(canReviewSeoFix("ADMIN", "HIGH")).toBe(true);
    });
    it("rejects invalid lifecycle transitions", () => {
        expect(() => assertSeoFixTransition("READY_FOR_REVIEW", "APPROVED")).not.toThrow();
        expect(() => assertSeoFixTransition("DETECTED", "VERIFIED")).toThrowError(/cannot move/u);
    });
    it("accepts safe same-host canonical URLs and rejects insecure or foreign URLs", () => {
        expect(safeHttpsUrl("https://example.com/page#section", "example.com")).toBe("https://example.com/page");
        expect(safeHttpsUrl("http://example.com/page", "example.com")).toBeNull();
        expect(safeHttpsUrl("https://other.example/page", "example.com")).toBeNull();
    });
    it("validates metadata, healthy link destinations, decorative image alt, and JSON-LD", () => {
        expect(validateSeoFixValue("MISSING_TITLE", "Useful title | Brand", "example.com")).toEqual({ title: "Useful title | Brand" });
        expect(() => validateSeoFixValue("MISSING_TITLE", "<b>Bad</b>", "example.com")).toThrow(/markup/u);
        expect(validateSeoFixValue("BROKEN_INTERNAL_LINK", "https://example.com/new", "example.com", ["https://example.com/new"])).toEqual({ replacementUrl: "https://example.com/new" });
        expect(() => validateSeoFixValue("BROKEN_INTERNAL_LINK", "https://example.com/not-crawled", "example.com", [])).toThrow(/healthy URL/u);
        expect(validateSeoFixValue("MISSING_IMAGE_ALT", '{"decorative":true,"value":""}', "example.com")).toEqual({ altText: "", decorative: true });
        expect(() => validateSeoFixValue("MISSING_IMAGE_ALT", '{"decorative":true,"value":"icon"}', "example.com")).toThrow(/empty alt/u);
        expect(validateSeoFixValue("MALFORMED_JSON_LD", '{"@context":"https://schema.org","@type":"Organization"}', "example.com")).toEqual({ jsonLd: { "@context": "https://schema.org", "@type": "Organization" } });
    });
});
