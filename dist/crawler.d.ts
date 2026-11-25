import type { LookupFunction } from "node:net";
import type { IncomingHttpHeaders } from "node:http";
import { type CheerioAPI } from "cheerio";
import { type Browser } from "playwright";
export declare function createPinnedLookup(address: string, family: 4 | 6): LookupFunction;
export type AuditSeverity = "CRITICAL" | "ERROR" | "WARNING" | "NOTICE";
export type AuditIssueDraft = {
    pageUrl: string | null;
    code: string;
    severity: AuditSeverity;
    message: string;
    details?: Record<string, unknown>;
};
export type CrawledLink = {
    targetUrl: string;
    internal: boolean;
    anchorText: string | null;
};
export type CrawledPage = {
    url: string;
    statusCode: number;
    title: string | null;
    titleLength: number | null;
    description: string | null;
    h1: string | null;
    canonical: string | null;
    robots: string | null;
    indexable: boolean;
    wordCount: number;
    loadMs: number;
    contentDigest: string;
    imageAltMissing: number;
    h1Count: number;
    links: CrawledLink[];
};
export type AuditResult = {
    pages: CrawledPage[];
    issues: AuditIssueDraft[];
    robotsFetched: boolean;
    pagesConsidered: number;
    healthScore: number;
    issueCounts: Record<AuditSeverity, number>;
};
export type AuditProgress = {
    pagesConsidered: number;
    pagesCrawled: number;
    issueCount: number;
};
export declare function isPublicIpAddress(address: string): boolean;
export declare function sitemapUrls(xml: string, baseUrl: string, expectedHost: string): {
    urls: string[];
    nested: string[];
};
export declare function sitemapPagesWithoutInboundLinks(sitemapPageUrls: string[], pages: CrawledPage[], rootUrl: string): string[];
export declare function inspectJsonLd(pageUrl: string, blocks: string[]): AuditIssueDraft[];
export declare function inspectTechnicalSignals(pageUrl: string, $: CheerioAPI, headers?: IncomingHttpHeaders): AuditIssueDraft[];
export type LivePageSnapshot = {
    page: CrawledPage;
    titleCount: number;
    descriptionCount: number;
    canonicalCount: number;
    visibleText: string;
    images: {
        url: string | null;
        alt: string | null;
        decorative: boolean;
        context: string;
    }[];
    jsonLd: string[];
    redirectChain: {
        from: string;
        to: string;
        statusCode: number;
    }[];
};
/** Re-fetch one previously crawled page with the crawler's HTTPS, same-host and DNS-pinning safeguards. */
export declare function readPublicPageSnapshot(pageUrl: string, expectedHost: string): Promise<LivePageSnapshot>;
export declare function browserResourceUrl(value: string, expectedHost: string): URL | null;
export declare function renderWithBrowser(browser: Browser, pageUrl: string, expectedHost: string, html: string): Promise<string>;
export declare function runSiteAudit(hostname: string, maxPages: number, onProgress?: (progress: AuditProgress) => Promise<void> | void): Promise<AuditResult>;
