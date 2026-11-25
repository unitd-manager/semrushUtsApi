declare const metaKeys: {
    readonly title: readonly ["_yoast_wpseo_title", "rank_math_title", "_aioseo_title"];
    readonly description: readonly ["_yoast_wpseo_metadesc", "rank_math_description", "_aioseo_description"];
    readonly canonical: readonly ["_yoast_wpseo_canonical", "rank_math_canonical_url"];
};
type SeoField = keyof typeof metaKeys;
export type WordPressFixCredentials = {
    accountId: string;
    siteUrl: string;
    username: string;
    applicationPassword: string;
};
type Credentials = WordPressFixCredentials;
type WpResource = {
    id: number;
    type: "pages" | "posts";
    link: string;
    title: {
        raw?: string;
        rendered?: string;
    };
    content?: {
        raw?: string;
        rendered?: string;
    };
    meta?: Record<string, unknown>;
};
export declare function findWordPressResource(credentials: Credentials, pageUrl: string): Promise<WpResource>;
export declare function readWordPressSeoField(credentials: Credentials, pageUrl: string, field: SeoField): Promise<{
    value: string;
    metaKey: string;
    resourceId: number;
}>;
export declare function writeWordPressSeoField(credentials: Credentials, pageUrl: string, field: SeoField, value: string): Promise<{
    value: string;
    metaKey: string;
    resourceId: number;
}>;
export declare function readWordPressImageAlt(credentials: Credentials, imageUrl: string): Promise<{
    value: string;
    resourceId: number;
}>;
export declare function writeWordPressImageAlt(credentials: Credentials, imageUrl: string, value: string): Promise<{
    value: string;
    resourceId: number;
}>;
export declare function readWordPressContent(credentials: Credentials, pageUrl: string): Promise<{
    content: string;
    resourceId: number;
    type: "pages" | "posts";
}>;
export declare function readWordPressPostForVerification(credentials: Credentials, postId: number): Promise<{
    id: number;
    status: string;
    title: string | null;
    content: string | null;
    url: string | null;
    modified: string | null;
}>;
export declare function writeWordPressContent(credentials: Credentials, pageUrl: string, content: string): Promise<{
    resourceId: number;
    type: "pages" | "posts";
}>;
export {};
