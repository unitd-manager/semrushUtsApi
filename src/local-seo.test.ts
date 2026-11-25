import { describe, expect, it } from "vitest";
import { buildNapAudit } from "./local-seo.js";

describe("local NAP consistency", () => {
  it("compares normalized name, address, and phone to the first recorded listing", () => {
    const result = buildNapAudit([
      { id: "a", businessName: "Acme Co.", address: { line1: "10 Main St.", city: "Boston", region: "MA", postalCode: "02110", country: "US" }, phone: "+1 (617) 555-0100" },
      { id: "b", businessName: "Acme Company", address: { line1: "11 Main St", city: "Boston", region: "MA", postalCode: "02110", country: "US" }, phone: "1.617.555.0100" },
    ]);
    expect(result).toMatchObject({ baselineListingId: "a", listingCount: 2 });
    expect(result.differences.map((item) => item.field)).toEqual(["business name", "address"]);
  });

  it("returns an empty baseline for no listing records", () => {
    expect(buildNapAudit([])).toEqual({ baselineListingId: null, listingCount: 0, differences: [] });
  });
});
