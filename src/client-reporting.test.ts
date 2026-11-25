import { describe, expect, it } from "vitest";
import { compareMetric, nextReportScheduleAt, previousCompletedPeriod, renderClientReportPdf } from "./client-reporting.js";

describe("client reporting calculations", () => {
  it("compares metrics without inventing a percentage for a zero baseline", () => {
    expect(compareMetric(12, 10)).toMatchObject({ difference: 2, percentChange: 20, direction: "up" });
    expect(compareMetric(0, 0)).toMatchObject({ difference: 0, percentChange: 0, direction: "flat" });
    expect(compareMetric(4, 0)).toMatchObject({ difference: 4, percentChange: null, direction: "up" });
    expect(compareMetric(null, 4)).toMatchObject({ current: null, percentChange: null, direction: "unavailable" });
  });

  it("calculates a previous calendar month in the requested timezone", () => {
    const period = previousCompletedPeriod(new Date("2026-03-15T12:00:00.000Z"), "MONTHLY", "America/New_York");
    expect(period.start.toISOString()).toBe("2026-02-01T05:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-03-01T04:59:00.000Z");
  });

  it("keeps a weekly schedule at the configured local weekday and hour", () => {
    const now = new Date("2026-11-04T12:00:00.000Z");
    const scheduled = nextReportScheduleAt(now, "WEEKLY", 1, 9, 30, "America/New_York");
    const local = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit", hour12: false }).format(scheduled);
    expect(local).toContain("Mon");
    expect(local).toContain("09:30");
  });

  it("renders a PDF file with page structure and source data", () => {
    const pdf = renderClientReportPdf({ snapshot: { sections: { gsc: { title: "Search Console", note: "Google data available.", metrics: { clicks: 20 } } } }, commentary: { executiveSummary: "Clicks increased based on connected Search Console data." }, manualNotes: "Next period: refresh content.", client: { name: "Example Client" }, title: "Monthly SEO Report", period: "October 2026", branding: { agencyName: "Example Agency" } });
    const contents = Buffer.from(pdf).toString("ascii");
    expect(contents.startsWith("%PDF-1.4")).toBe(true);
    expect(contents).toContain("Monthly SEO Report");
    expect(contents).toContain("Search Console");
    expect(contents).toContain("startxref");
  });
});
