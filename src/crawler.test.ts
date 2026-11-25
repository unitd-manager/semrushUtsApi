import { describe, expect, it } from "vitest";
import { load } from "cheerio";
import { browserResourceUrl, createPinnedLookup, inspectJsonLd, inspectTechnicalSignals, isPublicIpAddress, runSiteAudit, sitemapPagesWithoutInboundLinks, sitemapUrls, type CrawledPage } from "./crawler.js";

describe("Site Audit network boundaries", () => {
  it("returns the pinned address in both Node lookup callback forms", () => {
    const lookup = createPinnedLookup("8.8.8.8", 4);
    lookup("example.com", {}, (error, address, family) => {
      expect(error).toBeNull();
      expect(address).toBe("8.8.8.8");
      expect(family).toBe(4);
    });
    lookup("example.com", { all: true }, (error, addresses) => {
      expect(error).toBeNull();
      expect(addresses).toEqual([{ address: "8.8.8.8", family: 4 }]);
    });
  });

  it("allows public address literals and rejects private or reserved ranges", () => {
    expect(isPublicIpAddress("8.8.8.8")).toBe(true);
    expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true);
    for (const address of ["127.0.0.1", "10.2.3.4", "169.254.10.2", "192.168.1.2", "::1", "fc00::1", "fe80::1", "not-an-ip"]) {
      expect(isPublicIpAddress(address), address).toBe(false);
    }
  });

  it("allows only same-host HTTPS browser resources", () => {
    expect(browserResourceUrl("https://example.com/assets/app.js?version=1", "example.com")?.search).toBe("?version=1");
    for (const url of ["http://example.com/app.js", "https://cdn.example.com/app.js", "https://example.com:8443/app.js", "https://user@example.com/app.js", "file:///etc/passwd"]) {
      expect(browserResourceUrl(url, "example.com")).toBeNull();
    }
  });

  it("rejects raw IPs, paths, and invalid crawl limits before making requests", async () => {
    await expect(runSiteAudit("127.0.0.1", 5)).rejects.toThrow("public DNS hostname");
    await expect(runSiteAudit("example.com/path", 5)).rejects.toThrow("public DNS hostname");
    await expect(runSiteAudit("example.com", 251)).rejects.toThrow("between 1 and 250");
  });
});

describe("technical HTML signals", () => {
  it("reports missing language and viewport, mixed content, insecure internal links, and header noindex", () => {
    const $ = load('<html><head><script src="http://cdn.example.com/app.js"></script></head><body><a href="http://example.com/old">Old URL</a></body></html>');
    const issues = inspectTechnicalSignals("https://example.com/", $, { "x-robots-tag": "noindex" });
    expect(issues.map((item) => item.code)).toEqual(["MISSING_HTML_LANG", "MISSING_VIEWPORT", "NOINDEX", "MIXED_CONTENT", "HTTP_INTERNAL_LINK"]);
    expect(issues.find((item) => item.code === "NOINDEX")?.details).toMatchObject({ source: "meta_or_x_robots_tag" });
  });

  it("does not report missing mobile metadata or HTTP resources when signals are present", () => {
    const $ = load('<html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><img src="https://example.com/image.jpg"></head><body></body></html>');
    expect(inspectTechnicalSignals("https://example.com/", $, {})).toEqual([]);
  });
});

describe("sitemap discovery", () => {
  it("extracts same-host page URLs and nested sitemap locations", () => {
    const xml = `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://example.com/child.xml</loc></sitemap></sitemapindex>`;
    expect(sitemapUrls(xml, "https://example.com/sitemap.xml", "example.com")).toEqual({ urls: [], nested: ["https://example.com/child.xml"] });
    const pages = `<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://other.test/b</loc></url><url><loc>/relative</loc></url></urlset>`;
    expect(sitemapUrls(pages, "https://example.com/sitemap.xml", "example.com").urls).toEqual(["https://example.com/a", "https://example.com/relative"]);
  });

  it("reports only crawled sitemap pages without inbound links, excluding the crawl root", () => {
    const page = (url: string, links: CrawledPage["links"]): CrawledPage => ({
      url, statusCode: 200, title: "Page", titleLength: 4, description: null, h1: null, canonical: null, robots: null,
      indexable: true, wordCount: 1, loadMs: 1, contentDigest: "digest", imageAltMissing: 0, h1Count: 0, links,
    });
    const root = "https://example.com/";
    const linked = "https://example.com/linked";
    const orphan = "https://example.com/orphan";
    const notCrawled = "https://example.com/not-crawled";
    const pages = [page(root, [{ targetUrl: linked, internal: true, anchorText: "Linked" }]), page(linked, []), page(orphan, [])];
    expect(sitemapPagesWithoutInboundLinks([root, linked, orphan, notCrawled], pages, root)).toEqual([orphan]);
  });
});

describe("structured data audit", () => {
  it("flags malformed JSON-LD and schema.org nodes without a type", () => {
    const issues = inspectJsonLd("https://example.com/page", ["{ nope", JSON.stringify({ "@context": "https://schema.org", name: "Example" }), JSON.stringify({ "@context": "https://schema.org", "@type": "Article", headline: "Example", image: "https://example.com/article.jpg", datePublished: "2026-01-02", author: { "@type": "Person", name: "Alex" } })]);
    expect(issues.map((item) => item.code)).toEqual(["MALFORMED_JSON_LD", "JSON_LD_MISSING_TYPE"]);
    expect(issues[0].severity).toBe("ERROR");
  });

  it("accepts typed JSON-LD graphs and bounds inspection work", () => {
    expect(inspectJsonLd("https://example.com/page", [JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "Organization", name: "Example" }] })])).toEqual([]);
    expect(inspectJsonLd("https://example.com/page", Array.from({ length: 21 }, () => "{}"))).toContainEqual(expect.objectContaining({ code: "JSON_LD_CHECK_LIMIT", severity: "NOTICE" }));
  });

  it("checks common rich-result structure and reports malformed breadcrumb data", () => {
    const issues = inspectJsonLd("https://example.com/page", [JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Product", name: "Widget", image: "https://example.com/widget.jpg" },
        { "@type": "BreadcrumbList", itemListElement: [{ "@type": "Thing", position: "first", item: "" }] },
        { "@type": "Article", headline: "News", datePublished: "not-a-date", author: "Editor" },
      ],
    })]);
    expect(issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "SCHEMA_RECOMMENDED_PROPERTY_MISSING", "SCHEMA_INVALID_BREADCRUMB_ITEM", "SCHEMA_INVALID_DATE",
    ]));
  });
});
