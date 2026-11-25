export type ContentDraft = { title: string; body: string; targetKeyword: string | null; url: string | null };
export function scoreContentDraft(draft: ContentDraft): { score: number; wordCount: number; checks: { code: string; passed: boolean; detail: string }[] } {
  const words = draft.body.trim().split(/\s+/u).filter(Boolean);
  const titleLength = draft.title.trim().length;
  const normalizedKeyword = draft.targetKeyword?.trim().toLocaleLowerCase() ?? "";
  const checks = [
    { code: "title_length", passed: titleLength >= 30 && titleLength <= 65, detail: titleLength >= 30 && titleLength <= 65 ? "Title length is within the editorial guide (30–65 characters)." : `Title has ${titleLength} characters; the guide is 30–65.` },
    { code: "keyword_title", passed: !!normalizedKeyword && draft.title.toLocaleLowerCase().includes(normalizedKeyword), detail: !!normalizedKeyword && draft.title.toLocaleLowerCase().includes(normalizedKeyword) ? "Target phrase appears in the title." : "Target phrase is missing from the title or not set." },
    { code: "draft_length", passed: words.length >= 300, detail: words.length >= 300 ? `${words.length} words; review whether the article covers the topic.` : `${words.length} words; check whether the draft answers the reader's needs.` },
    { code: "subheadings", passed: /^#{2,3}\s+.+$/mu.test(draft.body), detail: /^#{2,3}\s+.+$/mu.test(draft.body) ? "At least one Markdown subheading is present." : "No Markdown H2/H3 subheading found." },
    { code: "canonical_url", passed: !!draft.url, detail: draft.url ? "A publication URL is recorded." : "No publication URL is recorded yet." },
  ];
  return { score: Math.round(checks.filter((check) => check.passed).length / checks.length * 100), wordCount: words.length, checks };
}
