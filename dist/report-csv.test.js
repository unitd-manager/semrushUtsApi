import { describe, expect, it } from "vitest";
import { reportToCsv } from "./report-csv.js";
describe("report CSV export", () => {
    it("flattens section rows and quotes fields safely", () => {
        const csv = reportToCsv({ sections: { rankings: { source: "provider", confidence: "PROVIDER_OBSERVED", rows: [{ keyword: "seo, audit", position: 3, url: "https://example.com/a\"b" }] } } });
        expect(csv).toContain('"rankings","1","keyword","seo, audit","provider","PROVIDER_OBSERVED"');
        expect(csv).toContain('"url","https://example.com/a""b"');
    });
    it("emits no-data rows and rejects invalid report configuration", () => {
        expect(reportToCsv({ sections: { backlinks: { status: "no_data", note: "No snapshot" } } })).toContain('"backlinks","","status","no_data"');
        expect(() => reportToCsv(null)).toThrow("Invalid report configuration");
    });
    it("neutralizes spreadsheet formula prefixes in untrusted string fields", () => {
        const csv = reportToCsv({ sections: { content: { rows: [{ title: "=HYPERLINK(\"https://bad\")" }] } } });
        expect(csv).toContain("'=HYPERLINK(");
    });
    it("exports the complete audit summary, finding rows, page inventory, and crawl history", () => {
        const csv = reportToCsv({ sections: { site_audit: {
                    summary: { healthScore: 92, issueTotal: 1 },
                    rows: [{ severity: "ERROR", code: "MISSING_TITLE", pageUrl: "https://example.com/", message: "Missing title" }],
                    pages: [{ url: "https://example.com/", statusCode: 200 }],
                    history: [{ id: "crawl-1", pagesCrawled: 1 }],
                } } });
        expect(csv).toContain('"site_audit","crawl_summary","healthScore","92"');
        expect(csv).toContain('"site_audit","finding_1","code","MISSING_TITLE"');
        expect(csv).toContain('"site_audit","page_1","statusCode","200"');
        expect(csv).toContain('"site_audit","history_1","pagesCrawled","1"');
    });
});
