const comparableFields = ["statusCode", "title", "description", "h1", "canonical", "robots", "indexable"];
export function comparePageSnapshots(before, after) {
    const changes = comparableFields.flatMap((field) => (before[field] ?? null) !== (after[field] ?? null) ? [{ field, before: before[field] ?? null, after: after[field] ?? null }] : []);
    if (before.contentDigest && after.contentDigest && before.contentDigest !== after.contentDigest)
        changes.push({ field: "contentDigest", before: before.contentDigest, after: after.contentDigest });
    if (before.h1Count != null && after.h1Count != null && before.h1Count !== after.h1Count)
        changes.push({ field: "h1Count", before: before.h1Count, after: after.h1Count });
    return changes;
}
export function suggestContextualLink(source, target, alreadyLinked) {
    if (alreadyLinked || source.url === target.url)
        return null;
    const terms = (value) => new Set((value ?? "").toLocaleLowerCase().match(/[a-z0-9]{4,}/gu) ?? []);
    const targetTerms = terms(target.title || target.h1);
    const sourceTerms = terms(`${source.title ?? ""} ${source.h1 ?? ""}`);
    const relevanceTerms = [...targetTerms].filter((term) => sourceTerms.has(term));
    if (!relevanceTerms.length)
        return null;
    return { relevanceTerms, suggestedAnchor: target.title ?? target.h1 ?? target.url };
}
export function classifyPageChangeRisk(changes) {
    return changes.some((change) => (change.field === "statusCode" && typeof change.after === "number" && change.after >= 400) || (change.field === "indexable" && change.after === false) || change.field === "canonical") ? "HIGH" : "MEDIUM";
}
export function classifySearchIntent(phrase) {
    const text = phrase.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/gu, " ").trim();
    const rules = [
        { intent: "TRANSACTIONAL", pattern: /\b(?:buy|order|shop|purchase|subscribe|book|hire|pricing|price|quote|coupon|discount|deal)\b/u, signal: "purchase_or_action_term" },
        { intent: "COMMERCIAL", pattern: /\b(?:best|top|review|reviews|vs|versus|compare|comparison|alternative|alternatives)\b/u, signal: "evaluation_term" },
        { intent: "INFORMATIONAL", pattern: /\b(?:what|why|how|when|where|who|guide|tutorial|meaning|definition|examples?)\b/u, signal: "question_or_learning_term" },
        { intent: "NAVIGATIONAL", pattern: /\b(?:login|log in|sign in|official|website|contact|support|careers)\b/u, signal: "destination_term" },
        { intent: "LOCAL", pattern: /\b(?:near me|nearby|local|in [a-z][a-z .'-]{1,40}|open now)\b/u, signal: "local_modifier" },
    ];
    const matched = rules.filter((rule) => rule.pattern.test(text));
    const intents = [...new Set(matched.map((item) => item.intent))];
    if (!intents.length)
        return { intent: null, confidence: 0, signals: [] };
    if (intents.length > 1)
        return { intent: "MIXED", confidence: 0.55, signals: matched.map((item) => item.signal) };
    const hasStrongPhrase = matched.some((item) => item.intent === intents[0] && item.pattern.test(text));
    return { intent: intents[0], confidence: hasStrongPhrase ? 0.72 : 0.6, signals: matched.map((item) => item.signal) };
}
export function analyzeContentPageSignals(page) {
    const findings = [];
    if (page.titleLength != null && page.titleLength > 0 && page.titleLength < 30)
        findings.push({ field: "title", code: "TITLE_SHORT", observed: page.titleLength, guidance: "Review whether the title clearly describes the page; the 30–60 character range is a heuristic, not a ranking requirement." });
    if (page.titleLength != null && page.titleLength > 60)
        findings.push({ field: "title", code: "TITLE_LONG", observed: page.titleLength, guidance: "Review whether the title can be made more concise; the 30–60 character range is a heuristic, not a ranking requirement." });
    const descriptionLength = page.description?.length ?? 0;
    if (page.description && descriptionLength < 70)
        findings.push({ field: "description", code: "DESCRIPTION_SHORT", observed: descriptionLength, guidance: "Review whether the description explains the page clearly; the 70–160 character range is a heuristic, not a ranking requirement." });
    if (page.description && descriptionLength > 160)
        findings.push({ field: "description", code: "DESCRIPTION_LONG", observed: descriptionLength, guidance: "Review whether the description can be made more concise; the 70–160 character range is a heuristic, not a ranking requirement." });
    if (page.h1Count != null && page.h1Count > 1)
        findings.push({ field: "h1", code: "MULTIPLE_H1", observed: page.h1Count, guidance: "Review the heading hierarchy and confirm the page has one clear primary heading." });
    if (page.wordCount != null && page.wordCount < 300)
        findings.push({ field: "body", code: "SHORT_BODY", observed: page.wordCount, guidance: "Review whether the page answers its intended query sufficiently; word count alone does not determine content quality." });
    return findings;
}
export function compareCompetitorKeywordSnapshots(before, after) {
    const keywords = (value) => Array.isArray(value) ? value.flatMap((item) => {
        if (!item || typeof item !== "object" || !("keyword" in item) || typeof item.keyword !== "string")
            return [];
        return [{ keyword: item.keyword.trim(), normalized: item.keyword.trim().toLocaleLowerCase(), evidence: item }];
    }).filter((item) => item.normalized) : [];
    const previous = keywords(before);
    const current = keywords(after);
    const previousByKey = new Map(previous.map((item) => [item.normalized, item]));
    const currentByKey = new Map(current.map((item) => [item.normalized, item]));
    return {
        added: [...currentByKey.values()].filter((item) => !previousByKey.has(item.normalized)).map(({ keyword, evidence }) => ({ keyword, evidence })),
        removed: [...previousByKey.values()].filter((item) => !currentByKey.has(item.normalized)).map(({ keyword, evidence }) => ({ keyword, evidence })),
    };
}
