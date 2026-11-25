import { describe, expect, it } from "vitest";
import { changedPageFields, changeRisk, eventDedupeKey } from "./competitor-monitoring-core.js";
const page = { statusCode: 200, title: "Old title", description: "Description", h1: "Heading", canonical: "https://example.com/a", robots: "index,follow", contentDigest: "a" };
describe("competitor monitoring change analysis", () => {
    it("does not report a baseline as a change and reports only changed fields", () => {
        expect(changedPageFields(null, page)).toEqual([]);
        expect(changedPageFields(page, { ...page, title: "New title" })).toEqual(["title"]);
    });
    it("classifies deindexing-sensitive changes above content edits", () => {
        expect(changeRisk(["robots"], page, { ...page, robots: "noindex" })).toBe("HIGH");
        expect(changeRisk(["title", "contentDigest"], page, { ...page, title: "New", contentDigest: "b" })).toBe("MEDIUM");
    });
    it("creates stable per-monitor, URL, baseline and observation dedupe keys", () => {
        const fields = ["title"];
        expect(eventDedupeKey("m", "https://example.com/a", "s1", [...fields], { ...page, title: "New" })).toBe(eventDedupeKey("m", "https://example.com/a", "s1", [...fields], { ...page, title: "New" }));
        expect(eventDedupeKey("m", "https://example.com/a", "s1", [...fields], { ...page, title: "New" })).not.toBe(eventDedupeKey("m", "https://example.com/a", "s2", [...fields], { ...page, title: "New" }));
    });
});
