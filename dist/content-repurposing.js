export const repurposeFormats = ["linkedin", "x", "email", "meta_description"];
function stripMarkdown(value) {
    return value.replace(/```[\s\S]*?```/g, " ").replace(/`([^`]+)`/g, "$1").replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/^\s{0,3}#{1,6}\s+/gm, "").replace(/^\s*[-*+]\s+/gm, "").replace(/\*\*|__/g, "").replace(/[*_~]/g, "").replace(/\s+/g, " ").trim();
}
function firstSentence(value) {
    const sentence = value.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
    return sentence || value.slice(0, 220).trim();
}
export function makeRepurposedDraft(input) {
    const text = stripMarkdown(input.body);
    const lead = firstSentence(text);
    const keyword = input.keyword?.trim();
    const title = input.title.trim();
    const outputTitle = (formatName) => `${title} - ${formatName}`.slice(0, 190);
    switch (input.format) {
        case "linkedin": {
            const paragraphs = text.split(/(?<=[.!?])\s+/).filter(Boolean);
            const copy = [lead, ...paragraphs.slice(1, 4)].join("\n\n");
            return { title: outputTitle("LinkedIn"), body: `${copy}\n\nWhat has your experience been?\n\n${keyword ? `#${keyword.toLowerCase().replace(/[^a-z0-9]+/g, "")} ` : ""}#ContentMarketing` };
        }
        case "x":
            return { title: outputTitle("X"), body: `${lead.slice(0, 220)}${lead.length > 220 ? "..." : ""}${keyword ? `\n\n#${keyword.toLowerCase().replace(/[^a-z0-9]+/g, "")}` : ""}`.slice(0, 280) };
        case "email":
            return { title: outputTitle("Email"), body: `Subject: ${title.slice(0, 160)}\n\nHi there,\n\n${text.slice(0, 1800)}\n\nIf this is useful, reply and tell us what you would like to learn next.\n\nBest,\n[Your name]` };
        case "meta_description":
            return { title: outputTitle("Meta description"), body: `${keyword ? `${keyword}: ` : ""}${lead} Read the practical takeaways.`.slice(0, 160) };
    }
}
