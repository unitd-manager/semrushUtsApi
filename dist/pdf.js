import { chromium } from "playwright";
export class PdfRendererUnavailableError extends Error {
    constructor() {
        super("Playwright Chromium could not be started. Install the Playwright Chromium browser for this API runtime.");
        this.name = "PdfRendererUnavailableError";
    }
}
export function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
export async function renderPdf(html) {
    let browser;
    try {
        browser = await chromium.launch({ headless: true, args: ["--dns-prefetch-disable", "--disable-background-networking"] });
    }
    catch {
        throw new PdfRendererUnavailableError();
    }
    try {
        const page = await browser.newPage();
        await page.route("**/*", (route) => route.abort("blockedbyclient"));
        await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 15_000 });
        await page.emulateMedia({ media: "print" });
        return Buffer.from(await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true }));
    }
    finally {
        await browser.close();
    }
}
