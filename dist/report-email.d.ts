export declare class ReportEmailFailure extends Error {
    readonly code: string;
    readonly retryable: boolean;
    constructor(message: string, code: string, retryable: boolean);
}
export declare function deliverClientReportEmail(input: {
    reportId: string;
    title: string;
    agencyName: string;
    recipient: string;
    reportUrl: string;
    pdf: Uint8Array;
    scheduledSlot: string;
    providerCredentials?: {
        apiKey?: string;
        from?: string;
    };
}, request?: typeof fetch): Promise<{
    provider: string;
    providerMessageId: string | null;
    acceptedAt: string;
    recipient: string;
}>;
export declare function deliverReportEmail(input: {
    reportId: string;
    title: string;
    configuration: unknown;
    recipients: string[];
    scheduledSlot: string;
    providerCredentials?: {
        apiKey?: string;
        from?: string;
    };
}, request?: typeof fetch): Promise<{
    provider: string;
    providerMessageId: string | null;
    recipientCount: number;
    deliveredAt: string;
}>;
