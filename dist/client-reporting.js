import { z } from "zod";
export const clientReportSectionKeys = ["executive_summary", "performance_analysis", "seo_overview", "gsc", "ga4", "rankings", "landing_pages", "technical_audit", "daily_briefing", "backlinks", "competitors", "completed_work", "outstanding_issues", "opportunities", "next_period_strategy", "client_commentary", "contact"];
export const clientReportFrequencies = ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"];
export const reportCommentarySchema = z.object({
    executiveSummary: z.string().trim().min(20).max(1800),
    performance: z.array(z.object({ title: z.string().trim().min(2).max(160), detail: z.string().trim().min(15).max(1200), evidence: z.array(z.string().max(300)).max(8), confidence: z.enum(["HIGH", "MEDIUM", "LOW"]) }).strict()).max(12),
    nextPeriodPriorities: z.array(z.object({ title: z.string().trim().min(2).max(160), reason: z.string().trim().min(15).max(1200), evidence: z.array(z.string().max(300)).max(8), confidence: z.enum(["HIGH", "MEDIUM", "LOW"]) }).strict()).max(8),
}).strict();
export const defaultReportSections = clientReportSectionKeys.map((key, position) => ({ sectionKey: key, title: key.replaceAll("_", " ").replace(/\b\w/g, (x) => x.toUpperCase()), position, enabled: true }));
export function compareMetric(current, previous) {
    if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous))
        return { current: current ?? null, previous: previous ?? null, difference: null, percentChange: null, direction: "unavailable" };
    const difference = current - previous;
    const percentChange = previous === 0 ? (current === 0 ? 0 : null) : difference / Math.abs(previous) * 100;
    return { current, previous, difference, percentChange, direction: difference > 0 ? "up" : difference < 0 ? "down" : "flat" };
}
function localParts(date, timezone) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { year: Number(map.year), month: Number(map.month), day: Number(map.day), hour: Number(map.hour), minute: Number(map.minute), weekday: weekdays[map.weekday] ?? 0 };
}
function localDateToUtc(parts, timezone) {
    let guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    for (let attempt = 0; attempt < 3; attempt++) {
        const actual = localParts(new Date(guess), timezone);
        const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
        const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
        const offset = represented - guess;
        guess = desired - offset;
    }
    return new Date(guess);
}
export function nextReportScheduleAt(now, frequency, scheduleDay, hour, minute, timezone, scheduleMonth = 1) {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59)
        throw new Error("Report schedule values are invalid.");
    if (frequency === "WEEKLY" ? scheduleDay < 0 || scheduleDay > 6 : scheduleDay < 1 || scheduleDay > 31)
        throw new Error("Report schedule day is invalid for this frequency.");
    if (!Number.isInteger(scheduleMonth) || scheduleMonth < 1 || scheduleMonth > 12 || (frequency === "QUARTERLY" && ![1, 4, 7, 10].includes(scheduleMonth)))
        throw new Error("Report schedule month is invalid for this frequency.");
    const current = localParts(now, timezone);
    let year = current.year;
    let month = current.month;
    let day = current.day;
    if (frequency === "DAILY") {
        day = current.day;
    }
    else if (frequency === "WEEKLY") {
        const weekday = scheduleDay;
        day += (weekday - current.weekday + 7) % 7;
    }
    else if (frequency === "MONTHLY")
        day = Math.min(scheduleDay, new Date(Date.UTC(year, month, 0)).getUTCDate());
    else if (frequency === "QUARTERLY" || frequency === "YEARLY") {
        month = scheduleMonth;
        day = Math.min(scheduleDay, new Date(Date.UTC(year, month, 0)).getUTCDate());
    }
    let candidate = localDateToUtc({ year, month, day, hour, minute }, timezone);
    if (candidate <= now) {
        if (frequency === "DAILY")
            candidate = localDateToUtc({ year, month, day: day + 1, hour, minute }, timezone);
        else if (frequency === "WEEKLY")
            candidate = localDateToUtc({ year, month, day: day + 7, hour, minute }, timezone);
        else if (frequency === "MONTHLY") {
            month++;
            if (month > 12) {
                month = 1;
                year++;
            }
            candidate = localDateToUtc({ year, month, day: Math.min(scheduleDay, new Date(Date.UTC(year, month, 0)).getUTCDate()), hour, minute }, timezone);
        }
        else if (frequency === "QUARTERLY") {
            month += 3;
            if (month > 12) {
                month -= 12;
                year++;
            }
            candidate = localDateToUtc({ year, month, day: Math.min(scheduleDay, new Date(Date.UTC(year, month, 0)).getUTCDate()), hour, minute }, timezone);
        }
        else if (frequency === "YEARLY") {
            year++;
            candidate = localDateToUtc({ year, month: scheduleMonth, day: Math.min(scheduleDay, new Date(Date.UTC(year, scheduleMonth, 0)).getUTCDate()), hour, minute }, timezone);
        }
    }
    return candidate;
}
export function previousCompletedPeriod(now, frequency, timezone) {
    const current = localParts(now, timezone);
    const date = new Date(Date.UTC(current.year, current.month - 1, current.day));
    let start;
    let end;
    if (frequency === "DAILY") {
        end = new Date(date.getTime() - 86400000);
        start = new Date(end);
    }
    else if (frequency === "WEEKLY") {
        const currentWeekStart = new Date(date);
        currentWeekStart.setUTCDate(date.getUTCDate() - current.weekday);
        end = new Date(currentWeekStart.getTime() - 86400000);
        start = new Date(end);
        start.setUTCDate(end.getUTCDate() - 6);
    }
    else if (frequency === "MONTHLY") {
        start = new Date(Date.UTC(current.year, current.month - 2, 1));
        end = new Date(Date.UTC(current.year, current.month - 1, 0));
    }
    else if (frequency === "QUARTERLY") {
        const quarterStartMonth = Math.floor((current.month - 1) / 3) * 3;
        start = new Date(Date.UTC(current.year, quarterStartMonth - 3, 1));
        end = new Date(Date.UTC(current.year, quarterStartMonth, 0));
    }
    else {
        start = new Date(Date.UTC(current.year - 1, 0, 1));
        end = new Date(Date.UTC(current.year - 1, 11, 31));
    }
    const asLocalStart = (value) => localDateToUtc({ year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate(), hour: 0, minute: 0 }, timezone);
    const asLocalEnd = (value) => localDateToUtc({ year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate(), hour: 23, minute: 59 }, timezone);
    return { start: asLocalStart(start), end: asLocalEnd(end) };
}
function cleanPdfText(value) { return value.normalize("NFKD").replace(/[^\x20-\x7E]/gu, " ").replace(/[()\\]/gu, "\\$&"); }
function wrap(text, width = 92) {
    const words = text.split(/\s+/u);
    const lines = [];
    let current = "";
    for (const word of words) {
        if (!word)
            continue;
        if (current && current.length + word.length + 1 > width) {
            lines.push(current);
            current = word;
        }
        else
            current += current ? ` ${word}` : word;
    }
    if (current)
        lines.push(current);
    return lines.length ? lines : [""];
}
function snapshotLines(snapshot, commentary, manualNotes, client, title, period, branding) {
    const lines = [];
    lines.push({ text: branding.agencyName || "Agency SEO Report", kind: "muted" }, { text: title, kind: "title" }, { text: `Prepared for ${client.name} | ${period}`, kind: "muted" });
    if (commentary.executiveSummary) {
        lines.push({ text: "Executive Summary", kind: "heading" });
        lines.push(...wrap(String(commentary.executiveSummary), 96).map((text) => ({ text, kind: "body" })));
    }
    for (const [sectionKey, section] of Object.entries(snapshot.sections ?? {})) {
        if (section.hidden)
            continue;
        lines.push({ text: String(section.title ?? sectionKey.replaceAll("_", " ").toUpperCase()), kind: "heading" });
        const note = section.note ?? section.availability ?? "";
        if (note)
            lines.push(...wrap(String(note), 96).map((text) => ({ text, kind: "muted" })));
        if (section.body)
            lines.push(...wrap(String(section.body), 96).map((text) => ({ text, kind: "body" })));
        const metrics = section.metrics && typeof section.metrics === "object" ? section.metrics : {};
        for (const [key, value] of Object.entries(metrics))
            lines.push({ text: `${key}: ${value ?? "Not available"}`, kind: "body" });
        const rows = Array.isArray(section.rows) ? section.rows.slice(0, 30) : [];
        for (const row of rows) {
            const label = row.keyword ?? row.query ?? row.page ?? row.url ?? row.title ?? row.domain ?? row.host ?? row.action ?? "Record";
            const metricsText = Object.entries(row).filter(([key, val]) => key !== "keyword" && key !== "query" && key !== "page" && key !== "url" && key !== "title" && key !== "domain" && key !== "host" && key !== "action" && val !== null && typeof val !== "object").slice(0, 5).map(([key, val]) => `${key}: ${val}`).join(" | ");
            lines.push(...wrap(`• ${label}${metricsText ? ` — ${metricsText}` : ""}`, 96).map((text) => ({ text, kind: "body" })));
        }
    }
    if (Array.isArray(commentary.nextPeriodPriorities) && commentary.nextPeriodPriorities.length) {
        lines.push({ text: "Next Period Priorities", kind: "heading" });
        for (const item of commentary.nextPeriodPriorities)
            lines.push(...wrap(`• ${item.title}: ${item.reason}`, 96).map((text) => ({ text, kind: "body" })));
    }
    if (manualNotes) {
        lines.push({ text: "Agency Commentary", kind: "heading" });
        lines.push(...wrap(manualNotes, 96).map((text) => ({ text, kind: "body" })));
    }
    if (branding.disclaimer)
        lines.push(...wrap(`Disclaimer: ${branding.disclaimer}`, 96).map((text) => ({ text, kind: "muted" })));
    return lines;
}
export function renderClientReportPdf(input) {
    const lines = snapshotLines(input.snapshot, input.commentary, input.manualNotes, input.client, input.title, input.period, input.branding);
    const pages = [];
    let page = [];
    let y = 744;
    for (const line of lines) {
        const wrapped = line.kind === "title" ? wrap(line.text, 70) : line.kind === "heading" ? wrap(line.text.toUpperCase(), 88) : wrap(line.text, 100);
        for (const text of wrapped) {
            if (y < 68) {
                pages.push(page);
                page = [];
                y = 744;
            }
            page.push(`${line.kind}|${text}`);
            y -= line.kind === "title" ? 28 : line.kind === "heading" ? 22 : 14;
        }
    }
    pages.push(page);
    const objects = [];
    const add = (value) => { objects.push(value); return objects.length; };
    const catalogId = add("");
    const pagesId = add("");
    const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    const boldId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
    const pageIds = [];
    pages.forEach((contentLines, index) => {
        const commands = ["0.08 0.42 0.37 rg 0 790 595 52 re f", "1 1 1 rg BT /F2 10 Tf 42 810 Td (CLIENT SEO REPORT) Tj ET", "0.12 0.19 0.19 rg"];
        let y = 758;
        for (const item of contentLines) {
            const [kind, ...bits] = item.split("|");
            const text = cleanPdfText(bits.join("|"));
            if (kind === "title") {
                commands.push(`0.12 0.19 0.19 rg BT /F2 20 Tf 42 ${y} Td (${text}) Tj ET`);
                y -= 28;
            }
            else if (kind === "heading") {
                commands.push(`0.08 0.42 0.37 rg BT /F2 12 Tf 42 ${y} Td (${text}) Tj ET`);
                y -= 20;
            }
            else {
                commands.push(`${kind === "muted" ? "0.38 0.45 0.45" : "0.18 0.25 0.25"} rg BT /F1 9 Tf 42 ${y} Td (${text}) Tj ET`);
                y -= 13;
            }
        }
        commands.push("0.55 0.62 0.61 RG 42 48 m 553 48 l S", `0.35 0.42 0.42 rg BT /F1 8 Tf 42 33 Td (${cleanPdfText(input.branding.agencyName || "SEO Client Report")}) Tj ET`, `0.35 0.42 0.42 rg BT /F1 8 Tf 520 33 Td (${index + 1} / ${pages.length}) Tj ET`);
        const content = commands.join("\n");
        const contentId = add(`<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`);
        pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldId} 0 R >> >> /Contents ${contentId} 0 R >>`));
    });
    objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf, "ascii")); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf, "ascii");
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") + `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return new Uint8Array(Buffer.from(pdf, "ascii"));
}
