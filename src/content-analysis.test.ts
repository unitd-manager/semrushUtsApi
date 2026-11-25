import { describe, expect, it } from "vitest";
import { compareContentSections, findUnsupportedClaimCandidates } from "./content-analysis.js";

describe("content review analysis", () => {
  it("reports paragraph-level changes without altering unchanged sections", () => {
    expect(compareContentSections("Intro\n\nOld section", "Intro\n\nNew section\n\nClosing")).toEqual([
      { section: 2, change: "changed", before: "Old section", after: "New section" },
      { section: 3, change: "added", before: null, after: "Closing" },
    ]);
  });

  it("flags claim-like wording for evidence review without asserting it is false", () => {
    expect(findUnsupportedClaimCandidates("We guarantee results.\n\nOur study showed a 40% improvement.")).toMatchObject([
      { text: "We guarantee results.", signals: ["absolute_guarantee"] },
      { text: "Our study showed a 40% improvement.", signals: ["quantified_claim"] },
    ]);
    expect(findUnsupportedClaimCandidates(null)).toEqual([]);
  });
});
