import { describe, expect, it } from "vitest";
import { makeRepurposedDraft } from "./content-repurposing.js";
const source = { title: "A Useful Guide", body: "# A Useful Guide\n\nSearch teams need a clear process. It helps teams find useful work. More detail follows.", keyword: "search teams" };
describe("content repurposing", () => {
    it("creates channel-specific drafts from source copy without inventing facts", () => {
        const post = makeRepurposedDraft({ ...source, format: "linkedin" });
        expect(post.title).toContain("LinkedIn");
        expect(post.body).toContain("Search teams need a clear process.");
        expect(post.body).toContain("#searchteams");
    });
    it("keeps short platform copy within the platform character limit", () => {
        const post = makeRepurposedDraft({ ...source, body: "A useful insight. ".repeat(100), format: "x" });
        expect(post.body.length).toBeLessThanOrEqual(280);
    });
    it("writes a constrained meta description and does not emit invented URLs", () => {
        const post = makeRepurposedDraft({ ...source, keyword: "keyword ".repeat(20), format: "meta_description" });
        expect(post.body.length).toBeLessThanOrEqual(160);
        expect(post.body).not.toMatch(/https?:\/\//);
    });
});
