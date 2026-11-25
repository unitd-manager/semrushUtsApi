import { z } from "zod";
export const manualResearchModules = ["map-rank-tracker", "pla-research", "ads-launch-assistant", "adclarity", "semrush-rank", "keyword-observations", "competitor-observations", "backlink-observations", "ranking-observations"];
const httpsUrl = z.string().url().max(2048).refine((value) => new URL(value).protocol === "https:", "Use an HTTPS URL.");
const base = z.object({ observedAt: z.string().datetime().optional(), notes: z.string().trim().max(3000).optional() });
const nullableNonnegative = z.number().nonnegative().finite().nullable().optional();
const schemas = {
    "map-rank-tracker": base.extend({ query: z.string().trim().min(1).max(160), location: z.string().trim().min(2).max(160), position: z.number().int().min(1).max(100).nullable(), sourceUrl: httpsUrl.nullable().optional() }),
    "pla-research": base.extend({ query: z.string().trim().min(1).max(160), merchant: z.string().trim().min(1).max(180), productTitle: z.string().trim().min(1).max(240), productUrl: httpsUrl, price: z.number().nonnegative().finite().nullable().optional(), currency: z.string().trim().length(3).default("USD") }),
    "ads-launch-assistant": z.object({ campaignName: z.string().trim().min(2).max(180), platform: z.enum(["google_ads", "microsoft_ads", "meta_ads"]), objective: z.string().trim().min(2).max(240), budget: z.number().positive().finite(), market: z.string().trim().min(2).max(120), headline: z.string().trim().min(1).max(120), description: z.string().trim().min(1).max(2000), landingUrl: httpsUrl, notes: z.string().trim().max(3000).optional() }),
    adclarity: base.extend({ advertiser: z.string().trim().min(1).max(180), channel: z.enum(["display", "video", "social", "other"]), format: z.string().trim().min(1).max(120), creativeText: z.string().trim().min(1).max(5000), sourceUrl: httpsUrl, landingUrl: httpsUrl.nullable().optional() }),
    "semrush-rank": base.extend({ domain: z.string().trim().min(3).max(253), country: z.string().trim().length(2).toUpperCase(), rank: z.number().int().positive().safe(), source: z.string().trim().min(1).max(180), sourceUrl: httpsUrl.nullable().optional() }),
    "keyword-observations": base.extend({ phrase: z.string().trim().min(1).max(180), country: z.enum(["US", "GB", "CA", "AU", "IN"]), searchVolume: z.number().int().nonnegative().safe().nullable().optional(), difficulty: z.number().min(0).max(100).nullable().optional(), intent: z.string().trim().max(80).nullable().optional(), cpc: nullableNonnegative, paidCompetition: z.number().min(0).max(1).nullable().optional(), source: z.string().trim().min(1).max(180), sourceUrl: httpsUrl.nullable().optional() }),
    "competitor-observations": base.extend({ domain: z.string().trim().min(3).max(253), country: z.enum(["US", "GB", "CA", "AU", "IN"]), overlappingKeywords: z.number().int().nonnegative().safe().nullable().optional(), estimatedTraffic: z.number().int().nonnegative().safe().nullable().optional(), source: z.string().trim().min(1).max(180), sourceUrl: httpsUrl.nullable().optional() }),
    "backlink-observations": base.extend({ sourceDomain: z.string().trim().min(3).max(253), sourceUrl: httpsUrl, targetUrl: httpsUrl, anchorText: z.string().trim().max(500).optional(), linkType: z.enum(["follow", "nofollow", "sponsored", "ugc", "unknown"]), source: z.string().trim().min(1).max(180) }),
    "ranking-observations": base.extend({ phrase: z.string().trim().min(1).max(180), country: z.enum(["US", "GB", "CA", "AU", "IN"]), device: z.enum(["desktop", "mobile"]), position: z.number().int().min(1).max(100).nullable(), rankingUrl: httpsUrl.nullable().optional(), source: z.string().trim().min(1).max(180) }),
};
export function isManualResearchModule(value) {
    return manualResearchModules.includes(value);
}
export function parseManualResearchInput(module, value) {
    return schemas[module].parse(value);
}
