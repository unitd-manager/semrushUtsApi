export type OnPageSnapshot = {
    url: string;
    statusCode: number | null;
    title: string | null;
    titleLength: number | null;
    description: string | null;
    h1: string | null;
    indexable: boolean | null;
    wordCount: number | null;
};
export type OnPageFinding = {
    code: string;
    title: string;
    description: string;
    evidence: Record<string, unknown>;
};
/** Produce cautious recommendations only from first-party crawl fields. */
export declare function buildOnPageFindings(page: OnPageSnapshot, targetKeyword: string): OnPageFinding[];
