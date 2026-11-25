export declare class WordPressFailure extends Error {
    readonly status: number;
    readonly code: string;
    constructor(message: string, status: number, code: string);
}
export declare function normalizeWordPressSite(value: string): URL;
export declare function verifyWordPressCredentials(siteUrl: string, username: string, applicationPassword: string, request?: typeof fetch): Promise<{
    siteUrl: string;
    userId: number;
    accountName: string;
}>;
export declare function createWordPressPost(input: {
    siteUrl: string;
    username: string;
    applicationPassword: string;
    title: string;
    content: string;
    status: "draft" | "publish";
}, request?: typeof fetch): Promise<{
    id: number;
    status: string;
    url: string | null;
    modified: string;
}>;
export declare function evaluateWordPressPostVerification(actual: {
    id: number;
    status: string;
    title: string | null;
    content: string | null;
    url: string | null;
}, expected: {
    id: number;
    status: "draft" | "publish";
    title: string;
    contentDigest: string;
    siteUrl: string;
}): {
    verified: boolean;
    checks: {
        postId: boolean;
        status: boolean;
        title: boolean;
        content: boolean;
        url: boolean;
    };
};
