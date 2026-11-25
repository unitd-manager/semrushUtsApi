/** Tenant-scoped keyword-to-page mapping API. Mount at /api/seo/keyword-mappings. */
export declare const keywordMappingRouter: import("express-serve-static-core").Router;
export declare function canonicalPageUrl(value: string, host: string): {
    url: string;
    key: string;
};
