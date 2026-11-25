export type NapListing = { id: string; businessName: string; address: Record<string, unknown>; phone: string | null };
function normalize(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase().replaceAll(/\s+/gu, " ").replaceAll(/[.,#]/gu, "");
}
function normalizePhone(value: string | null): string { return (value ?? "").replaceAll(/\D/gu, ""); }

/** Compare manually recorded citations to the workspace's oldest listing as an explicit baseline. */
export function buildNapAudit(listings: NapListing[]) {
  if (!listings.length) return { baselineListingId: null, listingCount: 0, differences: [] as { listingId: string; field: string; baseline: string; observed: string }[] };
  const baseline = listings[0]!;
  const addressValue = (address: Record<string, unknown>) => ["line1", "line2", "city", "region", "postalCode", "country"].map((key) => normalize(address[key])).join("|");
  const baselineAddress = addressValue(baseline.address);
  const differences: { listingId: string; field: string; baseline: string; observed: string }[] = [];
  for (const listing of listings.slice(1)) {
    const checks = [
      ["business name", normalize(baseline.businessName), normalize(listing.businessName)],
      ["address", baselineAddress, addressValue(listing.address)],
      ["phone", normalizePhone(baseline.phone), normalizePhone(listing.phone)],
    ] as const;
    for (const [field, expected, observed] of checks) if (expected !== observed) differences.push({ listingId: listing.id, field, baseline: expected, observed });
  }
  return { baselineListingId: baseline.id, listingCount: listings.length, differences };
}
