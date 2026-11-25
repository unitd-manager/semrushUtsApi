export type MapGridPoint = {
    label: string;
    coordinate: string;
};
export type MapRankObservation = {
    keyword: string;
    point: string;
    coordinate: string;
    position: number | null;
    listingName: string | null;
    listingUrl: string | null;
    placeId: string | null;
    rating: number | null;
    reviews: number | null;
    checkedAt: string;
};
export type MapRankResult = {
    provider: "dataforseo-google-maps";
    confidence: "PROVIDER_OBSERVED";
    billedCostUsd: number | null;
    observations: MapRankObservation[];
};
export declare class DataForSeoMapsProvider {
    private readonly config;
    private readonly request;
    readonly id: "dataforseo-google-maps";
    constructor(config: {
        login?: string;
        password?: string;
        enabled: boolean;
    }, request?: typeof fetch);
    check(input: {
        keywords: string[];
        points: MapGridPoint[];
        targetHost: string;
        languageCode?: string;
    }): Promise<MapRankResult>;
}
export declare function configuredDataForSeoMapsProvider(request?: typeof fetch, overrides?: {
    login?: string;
    password?: string;
    enabled?: boolean;
}): DataForSeoMapsProvider;
