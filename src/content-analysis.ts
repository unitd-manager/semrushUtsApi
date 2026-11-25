export type ContentSectionChange = { section: number; change: "added" | "removed" | "changed"; before: string | null; after: string | null };

function sections(body: string | null) {
  return (body ?? "").split(/\n\s*\n/u).map((text) => text.trim()).filter(Boolean).slice(0, 200);
}

export function compareContentSections(before: string | null, after: string | null): ContentSectionChange[] {
  const previous = sections(before);
  const current = sections(after);
  const changes: ContentSectionChange[] = [];
  for (let index = 0; index < Math.max(previous.length, current.length); index += 1) {
    const oldSection = previous[index] ?? null;
    const newSection = current[index] ?? null;
    if (oldSection === newSection) continue;
    changes.push({ section: index + 1, change: oldSection === null ? "added" : newSection === null ? "removed" : "changed", before: oldSection, after: newSection });
  }
  return changes;
}

export type ClaimCandidate = { text: string; signals: string[]; reviewPrompt: string };
const claimSignals: Array<{ code: string; pattern: RegExp }> = [
  { code: "absolute_guarantee", pattern: /\b(?:guarantee(?:d|s)?|always|never|risk[- ]free|no risk)\b/iu },
  { code: "superlative_or_exclusive", pattern: /\b(?:the best|number one|#1|leading|only solution|world[- ]class)\b/iu },
  { code: "quantified_claim", pattern: /\b\d+(?:\.\d+)?\s?(?:%|percent\b|x\b|times?\b|days?\b|weeks?\b|months?\b|years?\b)/iu },
  { code: "evidence_claim", pattern: /\b(?:proven|clinically tested|scientifically proven|research shows|studies show|data proves)\b/iu },
];

export function findUnsupportedClaimCandidates(body: string | null): ClaimCandidate[] {
  const candidates: ClaimCandidate[] = [];
  for (const paragraph of sections(body)) {
    for (const sentence of paragraph.split(/(?<=[.!?])\s+/u)) {
      const text = sentence.trim();
      const signals = claimSignals.filter((signal) => signal.pattern.test(text)).map((signal) => signal.code);
      if (signals.length) candidates.push({ text, signals, reviewPrompt: "Attach a source or qualify this statement; this wording scan cannot determine whether the claim is true." });
      if (candidates.length >= 100) return candidates;
    }
  }
  return candidates;
}
