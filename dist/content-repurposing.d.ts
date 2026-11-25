export declare const repurposeFormats: readonly ["linkedin", "x", "email", "meta_description"];
export type RepurposeFormat = typeof repurposeFormats[number];
export declare function makeRepurposedDraft(input: {
    title: string;
    body: string;
    keyword?: string | null;
    format: RepurposeFormat;
}): {
    title: string;
    body: string;
};
