import { describe, expect, it } from "vitest";
import { analyzeContentPageSignals, classifyPageChangeRisk, classifySearchIntent, compareCompetitorKeywordSnapshots, comparePageSnapshots, suggestContextualLink } from "./seo-intelligence.js";

describe("SEO intelligence evidence helpers", () => {
  it("compares only stored page fields and elevates indexing and canonical risks", () => {
    const before = { statusCode: 200, title: "Guide", description: "Old copy", h1: "Guide", canonical: null, robots: null, indexable: true };
    const after = { ...before, description: "Updated copy", indexable: false };
    const changes = comparePageSnapshots(before, after);
    expect(changes.map((change) => change.field)).toEqual(["description", "indexable"]);
    expect(classifyPageChangeRisk(changes)).toBe("HIGH");
    expect(classifyPageChangeRisk(comparePageSnapshots(before, { ...before, title: "New title" }))).toBe("MEDIUM");
    expect(comparePageSnapshots({ ...before, contentDigest: "old", h1Count: 1 }, { ...before, contentDigest: "new", h1Count: 2 }).map((change) => change.field)).toEqual(["contentDigest", "h1Count"]);
    expect(comparePageSnapshots({ ...before, contentDigest: null }, { ...before, contentDigest: "baseline" })).toEqual([]);
  });

  it("suggests a link only for relevant, distinct pages that are not already linked", () => {
    const source = { title: "Technical SEO guide", h1: "Technical SEO", url: "https://example.com/blog/guide" };
    const target = { title: "Technical SEO checklist", h1: "Checklist", url: "https://example.com/services/technical-seo" };
    expect(suggestContextualLink(source, target, false)?.relevanceTerms).toContain("technical");
    expect(suggestContextualLink(source, target, true)).toBeNull();
    expect(suggestContextualLink(source, { ...target, title: "Local bakery menu", h1: "Fresh bread", url: "https://example.com/menu" }, false)).toBeNull();
  });

  it("reports measured content gaps without treating missing measurements as zero", () => {
    expect(analyzeContentPageSignals({ title: "A short title", titleLength: 13, description: "Brief description", h1Count: 2, wordCount: 120 }).map((item) => item.code)).toEqual(["TITLE_SHORT", "DESCRIPTION_SHORT", "MULTIPLE_H1", "SHORT_BODY"]);
    expect(analyzeContentPageSignals({ title: "A sufficiently descriptive title", titleLength: 33, description: null, h1Count: null, wordCount: null })).toEqual([]);
    expect(analyzeContentPageSignals({ title: "A very long title with more than sixty characters in the text", titleLength: 62, description: "D".repeat(170), h1Count: 1, wordCount: 500 }).map((item) => item.code)).toEqual(["TITLE_LONG", "DESCRIPTION_LONG"]);
  });

  it("classifies search intent conservatively and exposes its rule evidence", () => {
    expect(classifySearchIntent("how to fix crawl errors")).toMatchObject({ intent: "INFORMATIONAL", confidence: 0.72, signals: ["question_or_learning_term"] });
    expect(classifySearchIntent("best local plumber near me")).toMatchObject({ intent: "MIXED", confidence: 0.55 });
    expect(classifySearchIntent("blue widgets")).toEqual({ intent: null, confidence: 0, signals: [] });
  });

  it("compares keyword snapshots case-insensitively without treating malformed data as keywords", () => {
    expect(compareCompetitorKeywordSnapshots([{ keyword: "SEO audit", rank: 5 }, { keyword: "old term" }], [{ keyword: "seo AUDIT", rank: 2 }, { keyword: "new term" }, null])).toMatchObject({
      added: [{ keyword: "new term" }],
      removed: [{ keyword: "old term" }],
    });
    expect(compareCompetitorKeywordSnapshots(null, null)).toEqual({ added: [], removed: [] });
  });
});
