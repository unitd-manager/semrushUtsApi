import { z } from "zod";
export declare const seoFixStatuses: readonly ["DETECTED", "ANALYZING", "FIX_GENERATED", "READY_FOR_REVIEW", "APPROVED", "REJECTED", "SCHEDULED", "EXECUTING", "SUCCESSFULLY_APPLIED", "VERIFICATION_PENDING", "VERIFIED", "FAILED", "ROLLED_BACK"];
export type SeoFixStatus = (typeof seoFixStatuses)[number];
export type SeoFixRisk = "LOW" | "MEDIUM" | "HIGH";
export declare function assertSeoFixTransition(from: string, to: SeoFixStatus): void;
export declare function seoFixCategory(issueType: string): string;
export declare function classifySeoFixRisk(issueType: string, operation?: string): SeoFixRisk;
export declare function canReviewSeoFix(role: string, risk: SeoFixRisk): boolean;
export declare const structuredFixResponseSchema: z.ZodObject<{
    proposedValue: z.ZodString;
    explanation: z.ZodString;
    expectedBenefit: z.ZodString;
    confidence: z.ZodNumber;
}, z.core.$strict>;
export declare function safeHttpsUrl(value: string, expectedHost: string): string | null;
export declare function validateSeoFixValue(issueType: string, proposedValue: string, expectedHost: string, allowedReplacementUrls?: string[]): unknown;
