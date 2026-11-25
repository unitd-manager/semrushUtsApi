export type NapListing = {
    id: string;
    businessName: string;
    address: Record<string, unknown>;
    phone: string | null;
};
/** Compare manually recorded citations to the workspace's oldest listing as an explicit baseline. */
export declare function buildNapAudit(listings: NapListing[]): {
    baselineListingId: null;
    listingCount: number;
    differences: {
        listingId: string;
        field: string;
        baseline: string;
        observed: string;
    }[];
} | {
    baselineListingId: string;
    listingCount: number;
    differences: {
        listingId: string;
        field: string;
        baseline: string;
        observed: string;
    }[];
};
