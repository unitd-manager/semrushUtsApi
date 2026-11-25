export declare class PdfRendererUnavailableError extends Error {
    constructor();
}
export declare function escapeHtml(value: unknown): string;
export declare function renderPdf(html: string): Promise<Buffer>;
