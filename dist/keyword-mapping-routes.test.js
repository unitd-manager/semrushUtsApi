import { describe, expect, it } from "vitest";
import { canonicalPageUrl } from "./keyword-mapping-routes.js";
describe("keyword mapping page URL policy", () => {
    it("canonicalizes same-host HTTPS URLs and hashes fragments away", () => {
        const normalized = canonicalPageUrl("https://www.example.com/services/clinic/?utm_source=x#details", "example.com");
        expect(normalized.url).toBe("https://example.com/services/clinic?utm_source=x");
        expect(normalized.key).toHaveLength(64);
    });
    it("rejects off-host, insecure, credentialed and port-switched URLs", () => {
        for (const value of ["http://example.com/a", "https://attacker.test/a", "https://example.com.evil.test/a", "https://user:pass@example.com/a", "https://example.com:8443/a"]) {
            expect(() => canonicalPageUrl(value, "example.com")).toThrow();
        }
    });
    it("treats www and apex hosts as the same website", () => {
        const apex = canonicalPageUrl("https://example.com/a", "www.example.com");
        const www = canonicalPageUrl("https://www.example.com/a", "example.com");
        expect(apex.key).toBe(www.key);
    });
});
