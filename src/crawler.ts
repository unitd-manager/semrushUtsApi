import { lookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import { BlockList, isIP } from "node:net";
import { createHash } from "node:crypto";
import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import { load, type CheerioAPI } from "cheerio";
import { chromium, type Browser } from "playwright";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 3500;
const MAX_REDIRECTS = 5;
const MAX_LINKS_PER_PAGE = 500;
const MAX_PAGES_PER_CRAWL = 250;
const CRAWL_CONCURRENCY = 5;
const MAX_BROWSER_REQUESTS_PER_PAGE = 30;
const MAX_BROWSER_RESOURCE_BYTES = 512 * 1024;
const MAX_RENDERED_PAGE_BYTES = 2 * 1024 * 1024;
const BROWSER_RENDER_TIMEOUT_MS = 8000;

export function createPinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

const blockedIpv4 = new BlockList();
const blockedIpv6 = new BlockList();
for (const range of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedIpv4.addSubnet(range[0], range[1], "ipv4");
for (const range of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48],
  ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7],
  ["fe80::", 10], ["ff00::", 8],
] as const) blockedIpv6.addSubnet(range[0], range[1], "ipv6");

export type AuditSeverity = "CRITICAL" | "ERROR" | "WARNING" | "NOTICE";
export type AuditIssueDraft = { pageUrl: string | null; code: string; severity: AuditSeverity; message: string; details?: Record<string, unknown> };
export type CrawledLink = { targetUrl: string; internal: boolean; anchorText: string | null };
export type CrawledPage = {
  url: string; statusCode: number; title: string | null; titleLength: number | null; description: string | null;
  h1: string | null; canonical: string | null; robots: string | null; indexable: boolean; wordCount: number;
  loadMs: number; contentDigest: string; imageAltMissing: number; h1Count: number; links: CrawledLink[];
};
export type AuditResult = { pages: CrawledPage[]; issues: AuditIssueDraft[]; robotsFetched: boolean; pagesConsidered: number; healthScore: number; issueCounts: Record<AuditSeverity, number> };
export type AuditProgress = { pagesConsidered: number; pagesCrawled: number; issueCount: number };

export function isPublicIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return !blockedIpv4.check(address, "ipv4");
  if (version === 6) return !blockedIpv6.check(address, "ipv6");
  return false;
}

function normalizedUrl(value: string, expectedHost: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" || url.hostname.toLowerCase() !== expectedHost.toLowerCase()) return null;
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+/gu, "/");
    return url;
  } catch { return null; }
}

async function publicAddressFor(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const directFamily = isIP(hostname);
  const addresses = directFamily ? [{ address: hostname, family: directFamily }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => !isPublicIpAddress(item.address))) throw new Error("Target hostname resolves to a non-public network address.");
  const selected = addresses[0];
  return { address: selected.address, family: selected.family as 4 | 6 };
}

type HttpResult = { statusCode: number; headers: IncomingHttpHeaders; body: Buffer; elapsedMs: number };

async function requestPublicHttps(url: URL, maxBodyBytes = MAX_BODY_BYTES): Promise<HttpResult> {
  const pinnedAddress = await publicAddressFor(url.hostname);
  const startedAt = Date.now();
  return await new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: "GET",
      servername: url.hostname,
      rejectUnauthorized: true,
      maxHeaderSize: 32 * 1024,
      headers: { "user-agent": "SearchlightSiteAudit/0.1 (+https://searchlight.invalid/crawler)", accept: "text/html,application/xhtml+xml,text/plain,application/xml;q=0.8,*/*;q=0.1", "accept-encoding": "identity" },
      lookup: createPinnedLookup(pinnedAddress.address, pinnedAddress.family),
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBodyBytes) { request.destroy(new Error(`Page response exceeded the ${maxBodyBytes}-byte response limit.`)); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ statusCode: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks), elapsedMs: Date.now() - startedAt }));
      response.on("error", reject);
    });
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error("Page request exceeded the 3.5 second timeout.")));
    request.on("error", reject);
    request.end();
  });
}

async function followSameHost(url: URL, expectedHost: string, redirect = 0, chain: { from: string; to: string; statusCode: number }[] = []): Promise<HttpResult & { finalUrl: string; redirectChain: { from: string; to: string; statusCode: number }[] }> {
  if (redirect > MAX_REDIRECTS) throw new Error("Page exceeded the five-redirect limit.");
  const result = await requestPublicHttps(url);
  if ([301, 302, 303, 307, 308].includes(result.statusCode)) {
    const location = result.headers.location;
    if (!location) throw new Error("Redirect response did not include a destination.");
    const destination = normalizedUrl(new URL(location, url).toString(), expectedHost);
    if (!destination) throw new Error("Redirect left the HTTPS website origin.");
    const next = await followSameHost(destination, expectedHost, redirect + 1, [...chain, { from: url.toString(), to: destination.toString(), statusCode: result.statusCode }]);
    return { ...next, elapsedMs: result.elapsedMs + next.elapsedMs };
  }
  return { ...result, finalUrl: url.toString(), redirectChain: chain };
}

async function robotsPolicy(host: string): Promise<{ fetched: boolean; disallow: string[]; sitemaps: string[] }> {
  const url = normalizedUrl(`https://${host}/robots.txt`, host)!;
  const response = await followSameHost(url, host);
  if (response.statusCode === 404) return { fetched: true, disallow: [], sitemaps: [] };
  if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`robots.txt returned HTTP ${response.statusCode}.`);
  const text = response.body.toString("utf8");
  const rules: { agent: string; path: string }[] = [];
  let appliesToAll = false;
  const sitemaps: string[] = [];
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.split("#", 1)[0].trim();
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "sitemap" && value) { sitemaps.push(value); continue; }
    if (key === "user-agent") appliesToAll = value === "*";
    else if (key === "disallow" && appliesToAll && value.startsWith("/")) rules.push({ agent: "*", path: value });
  }
  return { fetched: true, disallow: rules.map((rule) => rule.path), sitemaps };
}

export function sitemapUrls(xml: string, baseUrl: string, expectedHost: string): { urls: string[]; nested: string[] } {
  const $ = load(xml, { xmlMode: true });
  const urls: string[] = [];
  const nested: string[] = [];
  for (const node of $("url loc, sitemap loc").toArray()) {
    const value = $(node).text().trim();
    if (!value) continue;
    const url = normalizedUrl(new URL(value, baseUrl).toString(), expectedHost);
    if (!url) continue;
    const parent = $(node).parents("sitemap").length > 0;
    const list = parent ? nested : urls;
    if (!list.includes(url.toString())) list.push(url.toString());
  }
  return { urls, nested };
}

export function sitemapPagesWithoutInboundLinks(sitemapPageUrls: string[], pages: CrawledPage[], rootUrl: string): string[] {
  const sitemapSet = new Set(sitemapPageUrls);
  const linked = new Set<string>();
  for (const page of pages) for (const link of page.links) if (link.internal) {
    try { const url = new URL(link.targetUrl); url.hash = ""; linked.add(url.toString()); } catch { /* Ignore malformed stored links. */ }
  }
  return pages.filter((page) => sitemapSet.has(page.url) && page.url !== rootUrl && !linked.has(page.url)).map((page) => page.url);
}

export function inspectJsonLd(pageUrl: string, blocks: string[]): AuditIssueDraft[] {
  const issues: AuditIssueDraft[] = [];
  const recommendedProperties: Record<string, string[][]> = {
    Article: [["headline"], ["image"], ["datePublished"], ["author"]],
    Product: [["name"], ["image"], ["offers", "aggregateRating", "review"]],
    Organization: [["name"]],
    LocalBusiness: [["name"], ["address"]],
    BreadcrumbList: [["itemListElement"]],
    FAQPage: [["mainEntity"]],
    WebSite: [["name"], ["url"]],
  };
  const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
  const schemaContext = (context: unknown): boolean => {
    if (typeof context === "string") return /(?:https?:\/\/)?schema\.org(?:\/|$)/iu.test(context);
    if (Array.isArray(context)) return context.some(schemaContext);
    if (!isObject(context)) return false;
    return Object.values(context).some((value) => typeof value === "string" && /(?:https?:\/\/)?schema\.org(?:\/|$)/iu.test(value));
  };
  const hasValue = (value: unknown): boolean => {
    if (typeof value === "string") return Boolean(value.trim());
    if (Array.isArray(value)) return value.some(hasValue);
    if (isObject(value)) return Object.keys(value).length > 0;
    return value !== null && value !== undefined;
  };
  const typesOf = (value: unknown): string[] => typeof value === "string" ? [value.trim()].filter(Boolean) : Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];

  blocks.slice(0, 20).forEach((block, index) => {
    let parsed: unknown;
    try { parsed = JSON.parse(block); }
    catch { issues.push(issue(pageUrl, "MALFORMED_JSON_LD", "ERROR", "A JSON-LD script contains invalid JSON.", { block: index + 1 })); return; }
    const objects: { value: Record<string, unknown>; schema: boolean }[] = [];
    let nodeLimitReached = false;
    const visit = (value: unknown, inheritedSchema: boolean, depth: number, graphNode = false) => {
      if (depth > 8) return;
      if (objects.length >= 100) { nodeLimitReached = true; return; }
      if (Array.isArray(value)) {
        for (const item of value) visit(item, inheritedSchema, depth + 1, graphNode);
        return;
      }
      if (!isObject(value)) return;
      const schema = schemaContext(value["@context"]) || inheritedSchema;
      if (graphNode || value["@type"] !== undefined || (value["@context"] !== undefined && !Array.isArray(value["@graph"]))) objects.push({ value, schema });
      if (Array.isArray(value["@graph"])) for (const item of value["@graph"]) visit(item, schema, depth + 1, true);
      for (const [key, child] of Object.entries(value)) {
        if (key !== "@graph" && key !== "@context" && (Array.isArray(child) || isObject(child))) visit(child, schema, depth + 1);
      }
      if (value["@context"] !== undefined && !(typeof value["@context"] === "string" && value["@context"].trim()) && !Array.isArray(value["@context"]) && !isObject(value["@context"])) {
        issues.push(issue(pageUrl, "JSON_LD_INVALID_CONTEXT", "WARNING", "JSON-LD @context must be a URL, object, or array.", { block: index + 1 }));
      }
      const typeValue = value["@type"];
      const validType = typeof typeValue === "string" ? Boolean(typeValue.trim()) : Array.isArray(typeValue) && typeValue.length > 0 && typeValue.every((item) => typeof item === "string" && Boolean(item.trim()));
      if (typeValue !== undefined && !validType) {
        issues.push(issue(pageUrl, "JSON_LD_INVALID_TYPE", "WARNING", "JSON-LD @type must be a non-empty string or an array of non-empty strings.", { block: index + 1 }));
      }
    };
    if (!isObject(parsed) && !Array.isArray(parsed)) {
      issues.push(issue(pageUrl, "INVALID_JSON_LD_SHAPE", "WARNING", "JSON-LD must contain an object or an array of objects.", { block: index + 1 }));
      return;
    }
    visit(parsed, false, 0, Array.isArray(parsed));
    if (!objects.length) { issues.push(issue(pageUrl, "INVALID_JSON_LD_SHAPE", "WARNING", "JSON-LD must contain an object or an array of objects.", { block: index + 1 })); return; }
    for (const { value, schema } of objects) {
      const types = typesOf(value["@type"]);
      if (schema && !types.length) issues.push(issue(pageUrl, "JSON_LD_MISSING_TYPE", "WARNING", "A schema.org JSON-LD node is missing @type.", { block: index + 1 }));
      if (!schema || !types.length) continue;
      for (const type of types) {
        const simpleType = type.split(/[/:#]/u).filter(Boolean).pop() ?? type;
        const groups = recommendedProperties[simpleType];
        if (groups) {
          for (const group of groups) {
            if (!group.some((property) => hasValue(value[property]))) {
              issues.push(issue(pageUrl, "SCHEMA_RECOMMENDED_PROPERTY_MISSING", "NOTICE", `Schema.org ${simpleType} markup is missing a recommended property: ${group.join(" or ")}.`, { block: index + 1, type: simpleType, properties: group }));
            }
          }
        }
        if (simpleType === "BreadcrumbList" && Array.isArray(value.itemListElement)) {
          value.itemListElement.forEach((item, itemIndex) => {
            if (!isObject(item) || !typesOf(item["@type"]).includes("ListItem") || !Number.isInteger(item.position) || !hasValue(item.item)) {
              issues.push(issue(pageUrl, "SCHEMA_INVALID_BREADCRUMB_ITEM", "WARNING", "BreadcrumbList itemListElement entries should be ListItem objects with a position and item.", { block: index + 1, item: itemIndex + 1 }));
            }
          });
        }
      }
      for (const property of ["datePublished", "dateModified", "dateCreated"]) {
        if (value[property] !== undefined && (typeof value[property] !== "string" || !Number.isFinite(Date.parse(value[property])))) {
          issues.push(issue(pageUrl, "SCHEMA_INVALID_DATE", "WARNING", `Schema.org ${property} should be a parseable date string.`, { block: index + 1, property }));
        }
      }
      if (value.url !== undefined) {
        const candidate = isObject(value.url) ? value.url["@id"] ?? value.url.url : value.url;
        try { if (typeof candidate !== "string" || !new URL(candidate, pageUrl).hostname) throw new Error(); }
        catch { issues.push(issue(pageUrl, "SCHEMA_INVALID_URL", "WARNING", "Schema.org url should contain a valid URL or URL object.", { block: index + 1 })); }
      }
    }
    if (nodeLimitReached) issues.push(issue(pageUrl, "JSON_LD_NODE_LIMIT", "NOTICE", "Schema inspection stopped after 100 JSON-LD objects on this page.", { block: index + 1 }));
  });
  if (blocks.length > 20) issues.push(issue(pageUrl, "JSON_LD_CHECK_LIMIT", "NOTICE", "Only the first 20 JSON-LD blocks were inspected on this page.", { blockCount: blocks.length }));
  return issues;
}

export function inspectTechnicalSignals(pageUrl: string, $: CheerioAPI, headers: IncomingHttpHeaders = {}): AuditIssueDraft[] {
  const issues: AuditIssueDraft[] = [];
  if (!$("html").first().attr("lang")?.trim()) issues.push(issue(pageUrl, "MISSING_HTML_LANG", "WARNING", "The HTML element does not declare a language."));
  if (!$("head meta[name='viewport']").length) issues.push(issue(pageUrl, "MISSING_VIEWPORT", "WARNING", "Page does not declare a mobile viewport."));

  const xRobotsTag = String(headers["x-robots-tag"] ?? "").trim();
  const robots = [$("meta[name='robots']").first().attr("content")?.trim(), xRobotsTag].filter(Boolean).join("; ");
  if (/(?:^|[\s,;])(?:noindex|none)(?:$|[\s,;])/iu.test(robots)) {
    issues.push(issue(pageUrl, "NOINDEX", "NOTICE", "Page instructs search engines not to index it.", { robots, source: xRobotsTag ? "meta_or_x_robots_tag" : "meta_robots" }));
  }

  const mixedContent = new Set<string>();
  const resourceNodes = $("script[src], img[src], iframe[src], source[src], video[poster], audio[src], link[rel~='stylesheet'][href]").toArray();
  for (const node of resourceNodes) {
    const element = $(node);
    const raw = element.attr("src") ?? element.attr("poster") ?? element.attr("href");
    if (!raw) continue;
    try {
      const target = new URL(raw, pageUrl);
      if (target.protocol === "http:") mixedContent.add(target.toString());
    } catch { /* Invalid resource URLs are not fetched. */ }
  }
  if (mixedContent.size) issues.push(issue(pageUrl, "MIXED_CONTENT", "WARNING", "An HTTPS page references one or more resources over HTTP.", { count: mixedContent.size, urls: [...mixedContent].slice(0, 20) }));

  const insecureInternalLinks = new Set<string>();
  for (const node of $("a[href]").toArray()) {
    const raw = $(node).attr("href");
    if (!raw) continue;
    try {
      const target = new URL(raw, pageUrl);
      if (target.protocol === "http:" && target.hostname.toLowerCase() === new URL(pageUrl).hostname.toLowerCase()) insecureInternalLinks.add(target.toString());
    } catch { /* Invalid links are reported only when their target can be resolved. */ }
  }
  if (insecureInternalLinks.size) issues.push(issue(pageUrl, "HTTP_INTERNAL_LINK", "WARNING", "Internal links point to the same website over HTTP instead of HTTPS.", { count: insecureInternalLinks.size, urls: [...insecureInternalLinks].slice(0, 20) }));
  return issues;
}

export type LivePageSnapshot = {
  page: CrawledPage;
  titleCount: number;
  descriptionCount: number;
  canonicalCount: number;
  visibleText: string;
  images: { url: string | null; alt: string | null; decorative: boolean; context: string }[];
  jsonLd: string[];
  redirectChain: { from: string; to: string; statusCode: number }[];
};

/** Re-fetch one previously crawled page with the crawler's HTTPS, same-host and DNS-pinning safeguards. */
export async function readPublicPageSnapshot(pageUrl: string, expectedHost: string): Promise<LivePageSnapshot> {
  const requested = normalizedUrl(pageUrl, expectedHost);
  if (!requested) throw new Error("The page URL is outside the registered HTTPS website origin.");
  const response = await followSameHost(requested, expectedHost);
  if (response.finalUrl !== requested.toString()) throw new Error("The page now redirects to a different URL. Refresh the audit before generating a fix.");
  if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`The live page returned HTTP ${response.statusCode}.`);
  const parsed = parseHtml(response.finalUrl, response, expectedHost);
  if (!parsed.page) throw new Error("The live URL is not an HTML page.");
  const $ = load(response.body.toString("utf8"));
  const body = $("body").clone();
  body.find("script,style,noscript,template").remove();
  const visibleText = body.text().replace(/\s+/gu, " ").trim().slice(0, 12_000);
  const images = $("img").toArray().slice(0, 100).map((node) => {
    const element = $(node);
    const rawSrc = element.attr("src") ?? element.attr("data-src") ?? null;
    let imageUrl: string | null = null;
    try { imageUrl = rawSrc ? new URL(rawSrc, response.finalUrl).toString() : null; } catch { /* Leave invalid source unavailable. */ }
    const role = (element.attr("role") ?? "").toLowerCase();
    const decorative = element.attr("alt") === "" || role === "presentation" || role === "none" || element.attr("aria-hidden") === "true";
    const context = element.parent().text().replace(/\s+/gu, " ").trim().slice(0, 240);
    return { url: imageUrl, alt: element.attr("alt") ?? null, decorative, context };
  });
  return {
    page: parsed.page,
    titleCount: $("head title").length,
    descriptionCount: $("head meta[name='description']").length,
    canonicalCount: $("head link[rel~='canonical']").length,
    visibleText,
    images,
    jsonLd: $("script[type='application/ld+json']").toArray().slice(0, 20).map((node) => $(node).text().trim()).filter(Boolean),
    redirectChain: response.redirectChain,
  };
}

async function discoverSitemapUrls(host: string, declared: string[]): Promise<{ urls: string[]; issues: AuditIssueDraft[] }> {
  const issues: AuditIssueDraft[] = [];
  const candidates = declared.length ? declared : [`https://${host}/sitemap.xml`];
  const queue = candidates.slice(0, 5).flatMap((value) => {
    try { const url = normalizedUrl(new URL(value, `https://${host}/`).toString(), host); return url ? [url] : []; }
    catch { issues.push(issue(null, "INVALID_SITEMAP_LOCATION", "WARNING", "robots.txt contains an invalid or off-host sitemap location.")); return []; }
  });
  if (declared.length > 5) issues.push(issue(null, "SITEMAP_LIMIT", "NOTICE", "Only the first five sitemap locations in robots.txt were checked."));
  const visited = new Set<string>();
  const urls: string[] = [];
  while (queue.length && visited.size < 5 && urls.length < 1000) {
    const sitemap = queue.shift()!;
    if (visited.has(sitemap.toString())) continue;
    visited.add(sitemap.toString());
    try {
      const response = await followSameHost(sitemap, host);
      if (response.statusCode === 404) continue;
      if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`HTTP ${response.statusCode}`);
      const found = sitemapUrls(response.body.toString("utf8"), sitemap.toString(), host);
      urls.push(...found.urls.filter((url) => !urls.includes(url)).slice(0, 1000 - urls.length));
      for (const child of found.nested) if (!visited.has(child) && queue.length + visited.size < 5) queue.push(new URL(child));
      if (!found.urls.length && !found.nested.length) issues.push(issue(sitemap.toString(), "INVALID_SITEMAP", "WARNING", "Sitemap response did not contain valid same-host URL entries."));
    } catch (error) {
      issues.push(issue(sitemap.toString(), "SITEMAP_UNAVAILABLE", "NOTICE", "Sitemap could not be retrieved safely.", { reason: error instanceof Error ? error.message.slice(0, 200) : "Request failed" }));
    }
  }
  return { urls, issues };
}

function isDisallowed(path: string, disallow: string[]): boolean {
  return disallow.some((rule) => rule.length > 0 && path.startsWith(rule));
}

function issue(pageUrl: string | null, code: string, severity: AuditSeverity, message: string, details?: Record<string, unknown>): AuditIssueDraft {
  return { pageUrl, code, severity, message, ...(details ? { details } : {}) };
}

export function browserResourceUrl(value: string, expectedHost: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || url.hostname.toLowerCase() !== expectedHost.toLowerCase()) return null;
    url.hash = "";
    return url;
  } catch { return null; }
}

export async function renderWithBrowser(browser: Browser, pageUrl: string, expectedHost: string, html: string): Promise<string> {
  const context = await browser.newContext({ javaScriptEnabled: true, serviceWorkers: "block" });
  const page = await context.newPage();
  let requestCount = 0;
  let responseBytes = 0;
  await context.route("**/*", async (route) => {
    requestCount++;
    const request = route.request();
    const target = browserResourceUrl(request.url(), expectedHost);
    if (!target || request.method() !== "GET" || requestCount > MAX_BROWSER_REQUESTS_PER_PAGE) {
      await route.abort("blockedbyclient");
      return;
    }
    try {
      const response = await requestPublicHttps(target, MAX_BROWSER_RESOURCE_BYTES);
      responseBytes += response.body.length;
      if (responseBytes > MAX_RENDERED_PAGE_BYTES) {
        await route.abort("blockedbyclient");
        return;
      }
      const headers: Record<string, string> = {};
      const contentType = response.headers["content-type"];
      if (typeof contentType === "string") headers["content-type"] = contentType;
      const cacheControl = response.headers["cache-control"];
      if (typeof cacheControl === "string") headers["cache-control"] = cacheControl;
      const location = response.headers.location;
      if (typeof location === "string") headers.location = location;
      await route.fulfill({ status: response.statusCode, headers, body: response.body });
    } catch {
      await route.abort("failed");
    }
  });
  await context.routeWebSocket(/.*/u, (route) => route.close());
  try {
    await page.addInitScript(() => {
      for (const name of ["WebSocket", "RTCPeerConnection", "webkitRTCPeerConnection", "WebTransport"]) {
        Object.defineProperty(window, name, { value: undefined, configurable: false });
      }
    });
    const $ = load(html);
    if (!$("base[href]").length) $("<base>").attr("href", pageUrl).prependTo("head");
    await page.setContent($.html(), { waitUntil: "domcontentloaded", timeout: BROWSER_RENDER_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 1500 }).catch(() => undefined);
    return await page.content();
  } finally {
    await context.close();
  }
}

function parseHtml(finalUrl: string, response: HttpResult, expectedHost: string, renderedHtml?: string): { page: CrawledPage | null; issues: AuditIssueDraft[] } {
  const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) return { page: null, issues: [] };
  const html = renderedHtml ?? response.body.toString("utf8");
  const $ = load(html);
  const title = $("title").first().text().replace(/\s+/gu, " ").trim() || null;
  const description = $("meta[name='description']").first().attr("content")?.replace(/\s+/gu, " ").trim() || null;
  const h1s = $("h1").toArray().map((node) => $(node).text().replace(/\s+/gu, " ").trim()).filter(Boolean);
  const h1 = h1s[0] ?? null;
  const titleCount = $("head title").length;
  const descriptionCount = $("head meta[name='description']").length;
  const canonicalNodes = $("head link[rel~='canonical']").toArray();
  const canonicalValue = $("link[rel~='canonical']").first().attr("href")?.trim() || null;
  let canonical: string | null = null;
  const issues: AuditIssueDraft[] = [];
  if (canonicalValue) {
    try { canonical = new URL(canonicalValue, finalUrl).toString(); }
    catch { issues.push(issue(finalUrl, "INVALID_CANONICAL", "WARNING", "Canonical link is not a valid URL.")); }
  }
  const metaRobots = $("meta[name='robots']").first().attr("content")?.trim();
  const headerRobots = String(response.headers["x-robots-tag"] ?? "").trim();
  const robots = [metaRobots, headerRobots].filter(Boolean).join("; ") || null;
  const indexable = !/(?:^|[\s,;])(?:noindex|none)(?:$|[\s,;])/iu.test(robots ?? "");
  const missingAltImages = $("img").toArray().flatMap((node) => {
    const element = $(node);
    const role = (element.attr("role") ?? "").toLowerCase();
    if (element.attr("alt") !== undefined || role === "presentation" || role === "none" || element.attr("aria-hidden") === "true") return [];
    const rawSrc = element.attr("src") ?? element.attr("data-src") ?? null;
    let imageUrl: string | null = null;
    try { imageUrl = rawSrc ? new URL(rawSrc, finalUrl).toString() : null; } catch { /* Keep invalid source unavailable. */ }
    return [{ url: imageUrl, context: element.parent().text().replace(/\s+/gu, " ").trim().slice(0, 240) }];
  });
  const imageAltMissing = missingAltImages.length;
  const bodyText = $("body").text().replace(/\s+/gu, " ").trim();
  const links: CrawledLink[] = [];
  const seenTargets = new Set<string>();
  for (const node of $("a[href]").toArray()) {
    if (links.length >= MAX_LINKS_PER_PAGE) break;
    const href = $(node).attr("href")?.trim();
    if (!href || /^(?:mailto:|tel:|javascript:|data:)/iu.test(href)) continue;
    try {
      const target = new URL(href, finalUrl);
      if (!["http:", "https:"].includes(target.protocol)) continue;
      target.hash = "";
      const targetUrl = target.toString();
      if (seenTargets.has(targetUrl)) continue;
      seenTargets.add(targetUrl);
      links.push({ targetUrl, internal: target.hostname.toLowerCase() === expectedHost.toLowerCase(), anchorText: $(node).text().replace(/\s+/gu, " ").trim().slice(0, 300) || null });
    } catch { /* Invalid links are not fetched or expanded. */ }
  }
  const page: CrawledPage = {
    url: finalUrl, statusCode: response.statusCode, title, titleLength: title?.length ?? null, description, h1,
    canonical, robots, indexable, wordCount: bodyText ? bodyText.split(/\s+/u).length : 0, loadMs: response.elapsedMs,
    contentDigest: createContentDigest(bodyText), imageAltMissing, h1Count: h1s.length, links,
  };
  issues.push(...inspectTechnicalSignals(finalUrl, $, response.headers));
  if (!title) issues.push(issue(finalUrl, "MISSING_TITLE", "ERROR", "Page does not contain a title element."));
  else if (title.length < 30) issues.push(issue(finalUrl, "SHORT_TITLE", "NOTICE", "Title is shorter than the workspace's 30-character review threshold.", { characterCount: title.length, reviewThreshold: 30 }));
  else if (title.length > 60) issues.push(issue(finalUrl, "LONG_TITLE", "WARNING", "Title exceeds the workspace's 60-character review threshold.", { characterCount: title.length, reviewThreshold: 60 }));
  if (!description) issues.push(issue(finalUrl, "MISSING_META_DESCRIPTION", "WARNING", "Page does not contain a meta description."));
  else if (description.length < 120) issues.push(issue(finalUrl, "SHORT_META_DESCRIPTION", "NOTICE", "Meta description is shorter than the workspace's 120-character review threshold.", { characterCount: description.length, reviewThreshold: 120 }));
  else if (description.length > 160) issues.push(issue(finalUrl, "LONG_META_DESCRIPTION", "WARNING", "Meta description exceeds the workspace's 160-character review threshold.", { characterCount: description.length, reviewThreshold: 160 }));
  if (!canonicalValue) issues.push(issue(finalUrl, "MISSING_CANONICAL", "NOTICE", "Page does not contain a canonical link. Confirm that the URL should be self-canonical before adding one."));
  if (canonicalNodes.length > 1) issues.push(issue(finalUrl, "MULTIPLE_CANONICAL", "WARNING", "Page contains more than one canonical link element.", { count: canonicalNodes.length }));
  if (titleCount > 1) issues.push(issue(finalUrl, "MULTIPLE_TITLE", "WARNING", "Page contains more than one title element.", { count: titleCount }));
  if (descriptionCount > 1) issues.push(issue(finalUrl, "MULTIPLE_META_DESCRIPTION", "WARNING", "Page contains more than one meta description.", { count: descriptionCount }));
  if (!h1) issues.push(issue(finalUrl, "MISSING_H1", "WARNING", "Page does not contain an H1 heading."));
  if (h1s.length > 1) issues.push(issue(finalUrl, "MULTIPLE_H1", "NOTICE", "Page contains multiple H1 headings.", { count: h1s.length }));
  if (imageAltMissing) issues.push(issue(finalUrl, "MISSING_IMAGE_ALT", "WARNING", "One or more images with a missing alt attribute may need a descriptive or decorative treatment.", { count: imageAltMissing, images: missingAltImages.slice(0, 50) }));
  issues.push(...inspectJsonLd(finalUrl, $("script[type='application/ld+json']").toArray().map((node) => $(node).text().trim()).filter(Boolean)));
  if (canonical && new URL(canonical).hostname.toLowerCase() !== expectedHost.toLowerCase()) issues.push(issue(finalUrl, "EXTERNAL_CANONICAL", "WARNING", "Canonical URL points to a different hostname.", { canonical }));
  if (response.statusCode >= 400 && response.statusCode < 500) issues.push(issue(finalUrl, "HTTP_4XX", "ERROR", `Page returned HTTP ${response.statusCode}.`, { statusCode: response.statusCode }));
  if (response.statusCode >= 500) issues.push(issue(finalUrl, "HTTP_5XX", "CRITICAL", `Page returned HTTP ${response.statusCode}.`, { statusCode: response.statusCode }));
  return { page, issues };
}

function createContentDigest(text: string): string { return createHash("sha256").update(text.toLowerCase()).digest("hex"); }

export async function runSiteAudit(hostname: string, maxPages: number, onProgress?: (progress: AuditProgress) => Promise<void> | void): Promise<AuditResult> {
  const host = hostname.toLowerCase().replace(/\.$/u, "");
  if (!host || host.includes("/") || isIP(host)) throw new Error("Enter a public DNS hostname, not an IP address or URL path.");
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > MAX_PAGES_PER_CRAWL) throw new Error(`Site Audit page limit must be between 1 and ${MAX_PAGES_PER_CRAWL}.`);
  const root = normalizedUrl(`https://${host}/`, host);
  if (!root) throw new Error("Site Audit accepts an HTTPS origin hostname only.");
  await publicAddressFor(root.hostname);
  const robots = await robotsPolicy(host);
  const sitemap = await discoverSitemapUrls(host, robots.sitemaps);
  const pages: CrawledPage[] = [];
  const issues: AuditIssueDraft[] = [...sitemap.issues];
  const queue = [root.toString(), ...sitemap.urls.filter((url) => url !== root.toString())];
  const seen = new Set<string>();
  let pagesConsidered = 0;
  let browser: Browser;
  try { browser = await chromium.launch({ headless: true, args: ["--dns-prefetch-disable", "--disable-background-networking"] }); }
  catch { throw new Error("Playwright Chromium could not be started. Install the Playwright Chromium browser for this API runtime."); }
  try {
    while (queue.length && pagesConsidered < maxPages) {
      const batch: URL[] = [];
      while (queue.length && batch.length < CRAWL_CONCURRENCY && pagesConsidered + batch.length < maxPages) {
        const next = queue.shift()!;
        const url = normalizedUrl(next, host);
        if (!url || seen.has(url.toString()) || isDisallowed(url.pathname, robots.disallow)) continue;
        seen.add(url.toString());
        batch.push(url);
      }
      if (!batch.length) continue;
      pagesConsidered += batch.length;
      const results = await Promise.all(batch.map(async (url) => {
        try {
          const response = await followSameHost(url, host);
          const pageIssues = response.redirectChain.length > 1
            ? [issue(url.toString(), "REDIRECT_CHAIN", "WARNING", "This URL redirects through multiple same-host hops before reaching its final page.", { hops: response.redirectChain.length, chain: response.redirectChain })]
            : [];
          const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
          const renderedHtml = contentType.includes("text/html") || contentType.includes("application/xhtml+xml")
            ? await renderWithBrowser(browser, response.finalUrl, host, response.body.toString("utf8"))
            : undefined;
          const parsed = parseHtml(response.finalUrl, response, host, renderedHtml);
          return { url, page: parsed.page, issues: [...pageIssues, ...parsed.issues], error: null as unknown };
        } catch (error) {
          return { url, page: null, issues: [issue(url.toString(), "CRAWL_REQUEST_FAILED", "WARNING", "Page could not be retrieved or rendered safely.", { reason: error instanceof Error ? error.message.slice(0, 240) : "Page request failed." })], error };
        }
      }));
      for (const result of results) {
        if (result.error && result.url.toString() === root.toString() && !pages.length) throw result.error;
        issues.push(...result.issues);
        if (!result.page) continue;
        pages.push(result.page);
        for (const link of result.page.links) {
          if (!link.internal || queue.length > maxPages * 20) continue;
          const target = normalizedUrl(link.targetUrl, host);
          if (target && !seen.has(target.toString()) && !queue.includes(target.toString())) queue.push(target.toString());
        }
      }
      if (onProgress && (pagesConsidered >= maxPages || pagesConsidered % 10 === 0 || !queue.length)) {
        await onProgress({ pagesConsidered, pagesCrawled: pages.length, issueCount: issues.length });
      }
    }
  } finally {
    await browser.close();
  }
  const titleCounts = new Map<string, string[]>();
  const descriptionCounts = new Map<string, string[]>();
  const digestCounts = new Map<string, string[]>();
  for (const page of pages) {
    if (page.title) titleCounts.set(page.title.toLowerCase(), [...(titleCounts.get(page.title.toLowerCase()) ?? []), page.url]);
    if (page.description) descriptionCounts.set(page.description.toLowerCase(), [...(descriptionCounts.get(page.description.toLowerCase()) ?? []), page.url]);
    if (page.contentDigest && page.wordCount > 0) digestCounts.set(page.contentDigest, [...(digestCounts.get(page.contentDigest) ?? []), page.url]);
  }
  for (const urls of titleCounts.values()) if (urls.length > 1) for (const url of urls) issues.push(issue(url, "DUPLICATE_TITLE", "WARNING", "Title text is duplicated on multiple crawled pages.", { count: urls.length }));
  for (const urls of descriptionCounts.values()) if (urls.length > 1) for (const url of urls) issues.push(issue(url, "DUPLICATE_META_DESCRIPTION", "WARNING", "Meta description is duplicated on multiple crawled pages.", { count: urls.length }));
  for (const urls of digestCounts.values()) if (urls.length > 1) for (const url of urls) issues.push(issue(url, "DUPLICATE_CONTENT", "WARNING", "Normalized visible text matches another crawled page.", { count: urls.length }));
  const pageStatuses = new Map(pages.map((page) => [page.url, page.statusCode]));
  for (const page of pages) for (const link of page.links) if (link.internal) {
    const target = normalizedUrl(link.targetUrl, host);
    const targetStatus = target ? pageStatuses.get(target.toString()) : undefined;
    if (targetStatus && targetStatus >= 400) issues.push(issue(page.url, "BROKEN_INTERNAL_LINK", "ERROR", "Internal link points to a crawled page that returns an error.", { targetUrl: target?.toString(), statusCode: targetStatus }));
  }
  for (const pageUrl of sitemapPagesWithoutInboundLinks(sitemap.urls, pages, root.toString())) {
    issues.push(issue(pageUrl, "SITEMAP_PAGE_UNLINKED", "NOTICE", "This sitemap-listed page was not linked from any other page in this crawl.", { source: "sitemap_and_crawled_internal_links", crawlCoverage: pages.length }));
  }
  if (!robots.fetched) issues.push(issue(null, "ROBOTS_UNAVAILABLE", "NOTICE", "robots.txt was not checked."));
  const issueCounts: Record<AuditSeverity, number> = { CRITICAL: 0, ERROR: 0, WARNING: 0, NOTICE: 0 };
  for (const row of issues) issueCounts[row.severity]++;
  const penalty = issueCounts.CRITICAL * 12 + issueCounts.ERROR * 6 + issueCounts.WARNING * 2 + issueCounts.NOTICE;
  const healthScore = pages.length ? Math.max(0, 100 - Math.min(100, penalty)) : 0;
  return { pages, issues, robotsFetched: robots.fetched, pagesConsidered, healthScore, issueCounts };
}
