import { describe, expect, it } from "vitest";
import { bulkBacklinkQuerySchema } from "./bulk-backlink-analysis.js";

describe("bulk backlink analysis input", () => {
  it("trims and deduplicates selected project IDs", () => {
    expect(bulkBacklinkQuerySchema.parse({ projectIds: " p1, p2,p1 ,,p3 " }).projectIds).toEqual(["p1", "p2", "p3"]);
  });

  it("rejects empty input and more than 20 projects", () => {
    expect(() => bulkBacklinkQuerySchema.parse({ projectIds: " , , " })).toThrow();
    expect(() => bulkBacklinkQuerySchema.parse({ projectIds: Array.from({ length: 21 }, (_, index) => `p${index}`).join(",") })).toThrow();
  });
});
