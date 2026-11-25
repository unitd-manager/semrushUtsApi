export type TrafficEstimate = {
    target: string;
    locationCode: number;
    languageCode: string;
    organic: {
        etv: number | null;
        count: number | null;
    };
    paid: {
        etv: number | null;
        count: number | null;
    };
    featuredSnippet: {
        etv: number | null;
        count: number | null;
    };
    localPack: {
        etv: number | null;
        count: number | null;
    };
    observedAt: string;
    costUsd: number | null;
};
declare const locations: Record<string, number>;
export declare class DataForSeoTrafficProvider {
    private readonly config;
    private readonly request;
    constructor(config: {
        login?: string;
        password?: string;
        enabled: boolean;
    }, request?: typeof fetch);
    estimate(input: {
        target: string;
        country: keyof typeof locations;
    }): Promise<TrafficEstimate>;
}
export declare function configuredDataForSeoTrafficProvider(request?: typeof fetch, overrides?: {
    login?: string;
    password?: string;
    enabled?: boolean;
}): DataForSeoTrafficProvider;
export {};
