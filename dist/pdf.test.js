import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock("playwright", () => ({ chromium: { launch: mocks.launch } }));
import { escapeHtml, PdfRendererUnavailableError, renderPdf } from "./pdf.js";
describe("server PDF renderer", () => {
    beforeEach(() => mocks.launch.mockReset());
    it("renders a PDF in a network-blocked Chromium page and closes the browser", async () => {
        const page = {
            route: vi.fn(),
            setContent: vi.fn(),
            emulateMedia: vi.fn(),
            pdf: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])),
        };
        const browser = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn() };
        mocks.launch.mockResolvedValue(browser);
        const pdf = await renderPdf("<h1>Audit</h1>");
        expect(pdf).toEqual(Buffer.from("%PDF"));
        expect(page.route).toHaveBeenCalledWith("**/*", expect.any(Function));
        expect(page.setContent).toHaveBeenCalledWith("<h1>Audit</h1>", { waitUntil: "domcontentloaded", timeout: 15_000 });
        expect(page.pdf).toHaveBeenCalledWith({ format: "A4", printBackground: true, preferCSSPageSize: true });
        expect(browser.close).toHaveBeenCalledOnce();
    });
    it("provides an explicit runtime prerequisite error", () => {
        expect(new PdfRendererUnavailableError().message).toContain("Install the Playwright Chromium browser");
    });
    it("escapes untrusted report content", () => {
        expect(escapeHtml(`<script>alert("x")</script>`)).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    });
});
