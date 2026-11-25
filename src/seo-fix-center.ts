import { z } from "zod";

export const seoFixStatuses = ["DETECTED", "ANALYZING", "FIX_GENERATED", "READY_FOR_REVIEW", "APPROVED", "REJECTED", "SCHEDULED", "EXECUTING", "SUCCESSFULLY_APPLIED", "VERIFICATION_PENDING", "VERIFIED", "FAILED", "ROLLED_BACK"] as const;
export type SeoFixStatus = (typeof seoFixStatuses)[number];
export type SeoFixRisk = "LOW" | "MEDIUM" | "HIGH";

const transitions: Record<SeoFixStatus, SeoFixStatus[]> = {
  DETECTED: ["ANALYZING", "FAILED"],
  ANALYZING: ["FIX_GENERATED", "READY_FOR_REVIEW", "FAILED"],
  FIX_GENERATED: ["READY_FOR_REVIEW", "ANALYZING", "FAILED"],
  READY_FOR_REVIEW: ["APPROVED", "REJECTED", "ANALYZING"],
  APPROVED: ["SCHEDULED", "EXECUTING", "ANALYZING"],
  REJECTED: ["ANALYZING"],
  SCHEDULED: ["EXECUTING", "APPROVED", "FAILED"],
  EXECUTING: ["SUCCESSFULLY_APPLIED", "VERIFICATION_PENDING", "FAILED"],
  SUCCESSFULLY_APPLIED: ["VERIFICATION_PENDING", "VERIFIED", "FAILED"],
  VERIFICATION_PENDING: ["VERIFIED", "FAILED"],
  VERIFIED: ["ROLLED_BACK"],
  FAILED: ["ANALYZING"],
  ROLLED_BACK: [],
};

export function assertSeoFixTransition(from: string, to: SeoFixStatus): void {
  if (!seoFixStatuses.includes(from as SeoFixStatus) || !transitions[from as SeoFixStatus].includes(to)) {
    throw Object.assign(new Error(`The SEO fix cannot move from ${from} to ${to}.`), { status: 409, code: "invalid_fix_status_transition" });
  }
}

export function seoFixCategory(issueType: string): string {
  if (/TITLE|META_DESCRIPTION/u.test(issueType)) return "Metadata";
  if (/INTERNAL_LINK/u.test(issueType)) return "Internal Links";
  if (/REDIRECT/u.test(issueType)) return "Redirects";
  if (/CANONICAL/u.test(issueType)) return "Canonicals";
  if (/IMAGE_ALT/u.test(issueType)) return "Images and Alt Text";
  if (/JSON_LD|SCHEMA/u.test(issueType)) return "Structured Data";
  return "Other";
}

export function classifySeoFixRisk(issueType: string, operation?: string): SeoFixRisk {
  if (operation && ["redirect", "robots", "url", "template", "indexation"].includes(operation)) return "HIGH";
  if (/REDIRECT|NOINDEX|ROBOTS|URL_CHANGE/u.test(issueType)) return "HIGH";
  if (/CANONICAL|INTERNAL_LINK|JSON_LD|SCHEMA|DUPLICATE_TITLE|DUPLICATE_META|MULTIPLE_TITLE|MULTIPLE_META/u.test(issueType)) return "MEDIUM";
  return "LOW";
}

export function canReviewSeoFix(role: string, risk: SeoFixRisk): boolean {
  return risk === "HIGH" ? ["OWNER", "ADMIN"].includes(role) : ["OWNER", "ADMIN", "MANAGER"].includes(role);
}

export const structuredFixResponseSchema = z.object({
  proposedValue: z.string().trim().min(1).max(4000),
  explanation: z.string().trim().min(20).max(1400),
  expectedBenefit: z.string().trim().min(20).max(900),
  confidence: z.number().min(0).max(1),
}).strict();

export function safeHttpsUrl(value: string, expectedHost: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hostname.toLowerCase() !== expectedHost.toLowerCase()) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch { return null; }
}

export function validateSeoFixValue(issueType: string, proposedValue: string, expectedHost: string, allowedReplacementUrls: string[] = []): unknown {
  const plainText = (max: number) => {
    if (proposedValue.length > max || /<\/?[a-z][^>]*>/iu.test(proposedValue)) throw new Error("The proposed metadata contains markup or exceeds the safe length limit.");
    return proposedValue;
  };
  if (/TITLE/u.test(issueType)) {
    const value = plainText(70);
    if (value.length < 1) throw new Error("A title must contain at least one character.");
    return { title: value };
  }
  if (/META_DESCRIPTION/u.test(issueType)) {
    const value = plainText(320);
    if (value.length < 1) throw new Error("A meta description must contain at least one character.");
    return { description: value };
  }
  if (/CANONICAL/u.test(issueType)) {
    const canonical = safeHttpsUrl(proposedValue, expectedHost);
    if (!canonical) throw new Error("Canonical suggestions must be absolute HTTPS URLs on this registered website.");
    return { canonical };
  }
  if (/BROKEN_INTERNAL_LINK/u.test(issueType)) {
    const replacementUrl = safeHttpsUrl(proposedValue, expectedHost);
    if (!replacementUrl || !allowedReplacementUrls.includes(replacementUrl)) throw new Error("A broken-link replacement must exactly match a healthy URL recorded in the selected crawl.");
    return { replacementUrl };
  }
  if (/IMAGE_ALT/u.test(issueType)) {
    let parsed: unknown;
    try { parsed = JSON.parse(proposedValue); } catch { throw new Error("Alt text proposals must be JSON containing decorative and value fields."); }
    const alt = z.object({ decorative: z.boolean(), value: z.string().max(250) }).strict().parse(parsed);
    if (alt.decorative && alt.value !== "") throw new Error("Decorative images must use an empty alt value.");
    if (!alt.decorative && !alt.value.trim()) throw new Error("A meaningful image needs descriptive alt text.");
    if (/<\/?[a-z][^>]*>/iu.test(alt.value)) throw new Error("Alt text cannot contain markup.");
    return { altText: alt.value, decorative: alt.decorative };
  }
  if (/JSON_LD|SCHEMA/u.test(issueType)) {
    let parsed: unknown;
    try { parsed = JSON.parse(proposedValue); } catch { throw new Error("Structured data must be valid JSON."); }
    const object = z.record(z.string(), z.unknown()).parse(parsed);
    if (typeof object["@context"] !== "string" || !/schema\.org/iu.test(object["@context"])) throw new Error("Structured data must declare a schema.org context.");
    if (!(typeof object["@type"] === "string" && object["@type"].trim()) && !Array.isArray(object["@graph"])) throw new Error("Structured data needs a valid @type or @graph.");
    return { jsonLd: object };
  }
  if (/REDIRECT/u.test(issueType)) {
    let parsed: unknown;
    try { parsed = JSON.parse(proposedValue); } catch { throw new Error("Redirect suggestions must be JSON containing sourceUrl and destinationUrl."); }
    const rule = z.object({ sourceUrl: z.string().url(), destinationUrl: z.string().url(), statusCode: z.union([z.literal(301), z.literal(308)]) }).strict().parse(parsed);
    const sourceUrl = safeHttpsUrl(rule.sourceUrl, expectedHost);
    const destinationUrl = safeHttpsUrl(rule.destinationUrl, expectedHost);
    if (!sourceUrl || !destinationUrl || sourceUrl === destinationUrl) throw new Error("Redirect suggestions must use distinct HTTPS URLs on this website.");
    return { sourceUrl, destinationUrl, statusCode: rule.statusCode };
  }
  throw new Error("This issue type does not have a supported fix generator yet.");
}
