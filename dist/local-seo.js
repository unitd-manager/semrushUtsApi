function normalize(value) {
    return String(value ?? "").trim().toLocaleLowerCase().replaceAll(/\s+/gu, " ").replaceAll(/[.,#]/gu, "");
}
function normalizePhone(value) { return (value ?? "").replaceAll(/\D/gu, ""); }
/** Compare manually recorded citations to the workspace's oldest listing as an explicit baseline. */
export function buildNapAudit(listings) {
    if (!listings.length)
        return { baselineListingId: null, listingCount: 0, differences: [] };
    const baseline = listings[0];
    const addressValue = (address) => ["line1", "line2", "city", "region", "postalCode", "country"].map((key) => normalize(address[key])).join("|");
    const baselineAddress = addressValue(baseline.address);
    const differences = [];
    for (const listing of listings.slice(1)) {
        const checks = [
            ["business name", normalize(baseline.businessName), normalize(listing.businessName)],
            ["address", baselineAddress, addressValue(listing.address)],
            ["phone", normalizePhone(baseline.phone), normalizePhone(listing.phone)],
        ];
        for (const [field, expected, observed] of checks)
            if (expected !== observed)
                differences.push({ listingId: listing.id, field, baseline: expected, observed });
    }
    return { baselineListingId: baseline.id, listingCount: listings.length, differences };
}
