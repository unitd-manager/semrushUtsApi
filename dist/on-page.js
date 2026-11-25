/** Produce cautious recommendations only from first-party crawl fields. */
export function buildOnPageFindings(page, targetKeyword) {
    const findings = [];
    const term = targetKeyword.toLocaleLowerCase();
    if (page.statusCode == null || page.statusCode >= 400)
        findings.push({ code: "http_status", title: "Resolve the page response error", description: "The latest crawl recorded an unsuccessful HTTP response for this URL.", evidence: { statusCode: page.statusCode } });
    if (page.indexable === false)
        findings.push({ code: "indexability", title: "Review page indexability", description: "The latest crawl did not consider this page indexable. Check its robots directives and response headers before targeting it in search.", evidence: { indexable: page.indexable } });
    if (!page.title?.trim())
        findings.push({ code: "missing_title", title: "Add a descriptive page title", description: "The latest crawl did not find a title element for this page.", evidence: { title: page.title } });
    else {
        if ((page.titleLength ?? page.title.length) > 60)
            findings.push({ code: "title_length", title: "Review the title length", description: "The title exceeds 60 characters. Consider making it more concise; this is a heuristic, not a display guarantee.", evidence: { titleLength: page.titleLength ?? page.title.length } });
        if (!page.title.toLocaleLowerCase().includes(term))
            findings.push({ code: "keyword_title", title: "Consider the target phrase in the title", description: "The target phrase was not found as a literal substring in the crawled title. Use editorial judgment; exact phrase inclusion is not a ranking requirement.", evidence: { targetKeyword, title: page.title } });
    }
    if (!page.description?.trim())
        findings.push({ code: "missing_description", title: "Write a page description", description: "The latest crawl did not find a meta description.", evidence: { description: page.description } });
    if (!page.h1?.trim())
        findings.push({ code: "missing_h1", title: "Add a clear main heading", description: "The latest crawl did not find an H1 heading.", evidence: { h1: page.h1 } });
    else if (!page.h1.toLocaleLowerCase().includes(term))
        findings.push({ code: "keyword_h1", title: "Review the main heading against the target phrase", description: "The target phrase was not found as a literal substring in the crawled H1. Treat this as a review prompt, not a ranking rule.", evidence: { targetKeyword, h1: page.h1 } });
    if (page.wordCount != null && page.wordCount < 300)
        findings.push({ code: "content_length", title: "Review whether the page answers the query fully", description: "The crawler counted fewer than 300 words. There is no universal ideal word count; check whether the page satisfies the searcher's needs.", evidence: { wordCount: page.wordCount } });
    return findings;
}
