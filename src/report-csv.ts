type CsvSection = { status?: unknown; source?: unknown; confidence?: unknown; observedAt?: unknown; note?: unknown; rows?: unknown; summary?: unknown; history?: unknown; pages?: unknown; truncated?: unknown };
function valueText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
function quote(value: unknown): string {
  const raw = valueText(value);
  const safe = typeof value === "string" && /^[=+\-@\t\r]/u.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function reportToCsv(configuration: unknown): string {
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) throw new Error("Invalid report configuration.");
  const config = configuration as Record<string, unknown>;
  const sections = config.sections;
  if (!sections || typeof sections !== "object" || Array.isArray(sections)) throw new Error("Report has no section data.");
  const rows: unknown[][] = [["Section", "Record", "Field", "Value", "Source", "Confidence", "Observed at", "Note"]];
  for (const [sectionName, rawSection] of Object.entries(sections as Record<string, unknown>)) {
    if (!rawSection || typeof rawSection !== "object" || Array.isArray(rawSection)) continue;
    const section = rawSection as CsvSection;
    const rowData = Array.isArray(section.rows) ? section.rows : [];
    if (!rowData.length) rows.push([sectionName, "", "status", section.status ?? "no_data", section.source, section.confidence, section.observedAt, section.note]);
    const appendRecord = (recordName: string, row: unknown) => {
      if (row && typeof row === "object" && !Array.isArray(row)) {
        for (const [field, value] of Object.entries(row as Record<string, unknown>)) rows.push([sectionName, recordName, field, value, section.source, section.confidence, section.observedAt, section.note]);
      } else rows.push([sectionName, recordName, "value", row, section.source, section.confidence, section.observedAt, section.note]);
    };
    if (section.summary && typeof section.summary === "object" && !Array.isArray(section.summary)) appendRecord("crawl_summary", section.summary);
    for (let index = 0; index < rowData.length; index++) appendRecord(`${sectionName === "site_audit" ? "finding_" : ""}${index + 1}`, rowData[index]);
    for (const [collection, records] of [["history", section.history], ["page", section.pages]] as const) {
      if (!Array.isArray(records)) continue;
      for (let index = 0; index < records.length; index++) appendRecord(`${collection}_${index + 1}`, records[index]);
    }
    if (section.truncated === true) rows.push([sectionName, "", "truncated", "true", section.source, section.confidence, section.observedAt, section.note]);
  }
  return rows.map((row) => row.map(quote).join(",")).join("\r\n");
}
