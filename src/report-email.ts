import { createHash } from "node:crypto";
import { reportToCsv } from "./report-csv.js";

export class ReportEmailFailure extends Error {
  constructor(message: string, public readonly code: string, public readonly retryable: boolean) { super(message); this.name = "ReportEmailFailure"; }
}

export async function deliverClientReportEmail(input: { reportId: string; title: string; agencyName: string; recipient: string; reportUrl: string; pdf: Uint8Array; scheduledSlot: string; providerCredentials?: { apiKey?: string; from?: string } }, request: typeof fetch = fetch) {
  const apiKey = input.providerCredentials?.apiKey?.trim() || process.env.RESEND_API_KEY?.trim(); const from = input.providerCredentials?.from?.trim() || process.env.REPORT_EMAIL_FROM?.trim();
  if (!apiKey || !from) throw new ReportEmailFailure("Client report delivery is not configured. Set RESEND_API_KEY and REPORT_EMAIL_FROM.", "email_not_configured", false);
  if (input.pdf.length > 8 * 1024 * 1024) throw new ReportEmailFailure("The report PDF exceeds the email attachment limit.", "attachment_too_large", false);
  const idempotencyKey = createHash("sha256").update(`${input.reportId}:${input.scheduledSlot}:${input.recipient.toLowerCase()}`).digest("hex");
  let response: Response;
  try {
    response = await request("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify({ from, to: [input.recipient], subject: safeSubject(input.title), html: `<p>${escapeHtml(input.agencyName)} has prepared your SEO report.</p><p><strong>${escapeHtml(input.title)}</strong></p><p><a href="${escapeHtml(input.reportUrl)}">View the secure online report</a></p><p>The attached PDF contains source attribution and the reporting period. Provider acceptance does not confirm recipient receipt.</p>`, attachments: [{ filename: `${safeFilename(input.title)}.pdf`, content: Buffer.from(input.pdf).toString("base64") }] }), signal: AbortSignal.timeout(20_000) });
  } catch { throw new ReportEmailFailure("The email provider did not confirm whether delivery was accepted. Check the provider before retrying.", "email_result_unknown", true); }
  if (!response.ok) { const retryable = response.status === 429 || response.status >= 500; throw new ReportEmailFailure(retryable ? "The email provider temporarily rejected the report." : "The email provider rejected the report. Check sender configuration and recipient.", retryable ? "email_provider_temporary_failure" : "email_provider_rejected", retryable); }
  let result: { id?: unknown }; try { result = await response.json() as { id?: unknown }; } catch { throw new ReportEmailFailure("The provider accepted the request but returned no readable message ID. Check delivery status before retrying.", "email_result_unknown", true); }
  return { provider: "resend", providerMessageId: typeof result.id === "string" ? result.id : null, acceptedAt: new Date().toISOString(), recipient: input.recipient };
}

export async function deliverReportEmail(input: { reportId: string; title: string; configuration: unknown; recipients: string[]; scheduledSlot: string; providerCredentials?: { apiKey?: string; from?: string } }, request: typeof fetch = fetch) {
  const apiKey = input.providerCredentials?.apiKey?.trim() || process.env.RESEND_API_KEY?.trim();
  const from = input.providerCredentials?.from?.trim() || process.env.REPORT_EMAIL_FROM?.trim();
  if (!apiKey || !from) throw new ReportEmailFailure("Report email delivery is not configured. Set RESEND_API_KEY and REPORT_EMAIL_FROM.", "email_not_configured", false);
  let csv: string;
  try { csv = reportToCsv(input.configuration); } catch { throw new ReportEmailFailure("The saved report could not be converted to a CSV attachment.", "report_export_failed", false); }
  if (Buffer.byteLength(csv, "utf8") > 8 * 1024 * 1024) throw new ReportEmailFailure("The report CSV is larger than the 8 MiB email attachment limit.", "attachment_too_large", false);
  const idempotencyKey = createHash("sha256").update(`${input.reportId}:${input.scheduledSlot}`).digest("hex");
  let response: Response;
  try {
    response = await request("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify({
        from,
        to: input.recipients,
        subject: safeSubject(input.title),
        html: `<p>Your scheduled Searchlight report is attached.</p><p><strong>${escapeHtml(input.title)}</strong></p><p>This is a point-in-time snapshot. Each section includes its source, confidence, observation date, and data availability.</p>`,
        attachments: [{ filename: `${safeFilename(input.title)}.csv`, content: Buffer.from(csv, "utf8").toString("base64") }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch { throw new ReportEmailFailure("The email provider could not be reached. Delivery status is unknown; check the provider before retrying.", "email_result_unknown", true); }
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    throw new ReportEmailFailure(retryable ? "The email provider temporarily rejected the report delivery." : "The email provider rejected the report delivery. Check the sender domain and recipients.", retryable ? "email_provider_temporary_failure" : "email_provider_rejected", retryable);
  }
  let result: { id?: unknown };
  try { result = await response.json() as { id?: unknown }; } catch { throw new ReportEmailFailure("The provider accepted the request but returned an unreadable confirmation. Check delivery status before retrying.", "email_result_unknown", true); }
  return { provider: "resend", providerMessageId: typeof result.id === "string" ? result.id : null, recipientCount: input.recipients.length, deliveredAt: new Date().toISOString() };
}

function safeFilename(value: string) { return value.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 80) || "searchlight-report"; }
function safeSubject(value: string) { return value.replace(/[\r\n\u0000-\u001f\u007f]/gu, " ").trim().slice(0, 180) || "Searchlight report"; }
function escapeHtml(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
