import { describe, expect, it } from "vitest";
import { buildApprovedDisavowFile } from "./backlink-audit.js";
describe("approval-based disavow export", () => {
    it("deduplicates approved source domains and writes Google's domain format", () => {
        const result = buildApprovedDisavowFile(["https://www.spam.test/path", "http://spam.test/other", "https://sub.example.test/page"]);
        expect(result.domains).toEqual(["spam.test", "sub.example.test"]);
        expect(result.content).toContain("domain:spam.test\ndomain:sub.example.test\n");
    });
    it("rejects malformed source URLs rather than producing a partial file", () => {
        expect(() => buildApprovedDisavowFile(["javascript:alert(1)"])).toThrow("not an HTTP(S) URL");
    });
});
