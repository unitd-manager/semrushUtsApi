import { describe, expect, it } from "vitest";
import { scoreContentDraft } from "./content-score.js";

describe("content draft readiness checks", () => {
  it("labels the score as a checklist result and evaluates supplied draft fields", () => {
    const result = scoreContentDraft({ title: "Technical SEO: a practical checklist for teams", body: `## Start here\n${Array(300).fill("Useful guidance for readers.").join(" ")}`, targetKeyword: "technical seo", url: "https://example.com/technical-seo" });
    expect(result).toMatchObject({ score: 100, wordCount: 1203 });
    expect(result.checks.every((check) => check.passed)).toBe(true);
  });

  it("does not require or invent a target keyword or publication URL", () => {
    const result = scoreContentDraft({ title: "Draft", body: "First draft.", targetKeyword: null, url: null });
    expect(result.score).toBe(0);
    expect(result.checks.find((check) => check.code === "keyword_title")?.passed).toBe(false);
  });
});
