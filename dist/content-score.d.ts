export type ContentDraft = {
    title: string;
    body: string;
    targetKeyword: string | null;
    url: string | null;
};
export declare function scoreContentDraft(draft: ContentDraft): {
    score: number;
    wordCount: number;
    checks: {
        code: string;
        passed: boolean;
        detail: string;
    }[];
};
