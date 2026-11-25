export type ContentSectionChange = {
    section: number;
    change: "added" | "removed" | "changed";
    before: string | null;
    after: string | null;
};
export declare function compareContentSections(before: string | null, after: string | null): ContentSectionChange[];
export type ClaimCandidate = {
    text: string;
    signals: string[];
    reviewPrompt: string;
};
export declare function findUnsupportedClaimCandidates(body: string | null): ClaimCandidate[];
