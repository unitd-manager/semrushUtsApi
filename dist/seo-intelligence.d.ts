export type PageSnapshot = {
    statusCode: number | null;
    title: string | null;
    description: string | null;
    h1: string | null;
    canonical: string | null;
    robots: string | null;
    indexable: boolean | null;
    h1Count?: number | null;
    contentDigest?: string | null;
};
export type PageChange = {
    field: keyof PageSnapshot;
    before: string | number | boolean | null;
    after: string | number | boolean | null;
};
export declare function comparePageSnapshots(before: PageSnapshot, after: PageSnapshot): PageChange[];
export declare function suggestContextualLink(source: {
    title: string | null;
    h1: string | null;
    url: string;
}, target: {
    title: string | null;
    h1: string | null;
    url: string;
}, alreadyLinked: boolean): {
    relevanceTerms: string[];
    suggestedAnchor: string;
} | null;
export declare function classifyPageChangeRisk(changes: PageChange[]): "HIGH" | "MEDIUM";
export type SearchIntent = "INFORMATIONAL" | "COMMERCIAL" | "TRANSACTIONAL" | "NAVIGATIONAL" | "LOCAL" | "MIXED";
export declare function classifySearchIntent(phrase: string): {
    intent: SearchIntent | null;
    confidence: number;
    signals: string[];
};
export type ContentPageSignals = {
    title: string | null;
    titleLength: number | null;
    description: string | null;
    h1Count: number | null;
    wordCount: number | null;
};
export declare function analyzeContentPageSignals(page: ContentPageSignals): {
    field: string;
    code: string;
    observed: number;
    guidance: string;
}[];
export declare function compareCompetitorKeywordSnapshots(before: unknown, after: unknown): {
    added: {
        keyword: any;
        evidence: any;
    }[];
    removed: {
        keyword: any;
        evidence: any;
    }[];
};
