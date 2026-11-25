import { lookup } from "node:dns/promises";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import { createPinnedLookup, isPublicIpAddress } from "../crawler.js";
import { normalizeWordPressSite, WordPressFailure } from "./wordpress.js";

const maxRestResponseBytes = 4 * 1024 * 1024;
const metaKeys = {
  title: ["_yoast_wpseo_title", "rank_math_title", "_aioseo_title"],
  description: ["_yoast_wpseo_metadesc", "rank_math_description", "_aioseo_description"],
  canonical: ["_yoast_wpseo_canonical", "rank_math_canonical_url"],
} as const;
type SeoField = keyof typeof metaKeys;
export type WordPressFixCredentials = { accountId: string; siteUrl: string; username: string; applicationPassword: string };
type Credentials = WordPressFixCredentials;
type WpResource = { id: number; type: "pages" | "posts"; link: string; title: { raw?: string; rendered?: string }; content?: { raw?: string; rendered?: string }; meta?: Record<string, unknown> };

function authHeader(username: string, password: string) { return `Basic ${Buffer.from(`${username}:${password.replaceAll(" ", "")}`).toString("base64")}`; }

async function pinnedWordPressRequest<T>(credentials: Credentials, path: string, method = "GET", body?: unknown): Promise<T> {
  const site = normalizeWordPressSite(credentials.siteUrl);
  const url = new URL(path, site);
  if (url.origin !== site.origin || !url.pathname.startsWith("/wp-json/wp/v2/")) throw new WordPressFailure("WordPress request path is outside the allowed REST API.", 400, "invalid_request_path");
  const addresses = await lookup(site.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((address) => !isPublicIpAddress(address.address))) throw new WordPressFailure("The connected WordPress host no longer resolves only to public addresses.", 400, "private_site_not_allowed");
  const address = addresses[0];
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  return await new Promise<T>((resolve, reject) => {
    const request = https.request(url, {
      method,
      servername: site.hostname,
      rejectUnauthorized: true,
      maxHeaderSize: 32 * 1024,
      lookup: createPinnedLookup(address.address, address.family as 4 | 6),
      headers: { authorization: authHeader(credentials.username, credentials.applicationPassword), accept: "application/json", ...(payload ? { "content-type": "application/json", "content-length": String(payload.length) } : {}) },
    }, (response: IncomingMessage) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxRestResponseBytes) { request.destroy(new Error("WordPress response exceeded the size limit.")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const status = response.statusCode ?? 0;
        if (status < 200 || status >= 300) { reject(new WordPressFailure(status === 401 || status === 403 ? "WordPress rejected the connected user's permissions." : `WordPress REST API returned HTTP ${status}.`, status === 401 || status === 403 ? 403 : status >= 500 ? 502 : status, status === 401 || status === 403 ? "credentials_or_permissions_rejected" : "wordpress_request_failed")); return; }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T); }
        catch { reject(new WordPressFailure("WordPress returned invalid JSON for an SEO fix operation.", 502, "invalid_response")); }
      });
      response.on("error", reject);
    });
    request.setTimeout(15_000, () => request.destroy(new Error("WordPress request timed out.")));
    request.on("error", (error) => reject(new WordPressFailure(error.message.includes("timed out") ? "WordPress request timed out; inspect the website before retrying." : "WordPress could not be reached. Inspect the website before retrying.", 502, "wordpress_result_unknown")));
    if (payload) request.write(payload);
    request.end();
  });
}

function normalizedPagePath(value: string): string | null {
  try { const url = new URL(value); if (url.protocol !== "https:" || url.search || url.hash) return null; return `${url.origin}${url.pathname.replace(/\/+$/u, "") || "/"}`; }
  catch { return null; }
}

export async function findWordPressResource(credentials: Credentials, pageUrl: string): Promise<WpResource> {
  const site = normalizeWordPressSite(credentials.siteUrl);
  const requested = new URL(pageUrl);
  if (requested.origin !== site.origin) throw new WordPressFailure("The page URL does not match the connected WordPress origin.", 403, "wordpress_project_mismatch");
  const segments = requested.pathname.split("/").filter(Boolean);
  const slug = decodeURIComponent(segments.at(-1) ?? "");
  if (!slug) throw new WordPressFailure("WordPress home-page SEO fixes are unsupported by the post adapter.", 409, "unsupported_wordpress_resource");
  const query = `?slug=${encodeURIComponent(slug)}&context=edit&per_page=100`;
  for (const type of ["pages", "posts"] as const) {
    const rows = await pinnedWordPressRequest<WpResource[]>(credentials, `/wp-json/wp/v2/${type}${query}`);
    if (!Array.isArray(rows)) throw new WordPressFailure("WordPress returned an invalid resource list.", 502, "invalid_response");
    const exact = rows.find((row) => normalizedPagePath(row.link) === normalizedPagePath(pageUrl));
    if (exact && typeof exact.id === "number" && exact.title) return { ...exact, type };
  }
  throw new WordPressFailure("The exact audited URL was not found as an editable WordPress page or post.", 404, "wordpress_resource_not_found");
}

function exposedMetaKey(resource: WpResource, field: SeoField): string {
  const exposed = resource.meta ?? {};
  const key = metaKeys[field].find((candidate) => Object.prototype.hasOwnProperty.call(exposed, candidate));
  if (!key) throw new WordPressFailure(`No supported SEO plugin exposed a writable ${field} field for this WordPress page.`, 409, "wordpress_seo_field_unsupported");
  return key;
}

export async function readWordPressSeoField(credentials: Credentials, pageUrl: string, field: SeoField): Promise<{ value: string; metaKey: string; resourceId: number }> {
  const resource = await findWordPressResource(credentials, pageUrl);
  const metaKey = exposedMetaKey(resource, field);
  const current = resource.meta?.[metaKey];
  return { value: typeof current === "string" ? current : "", metaKey, resourceId: resource.id };
}

export async function writeWordPressSeoField(credentials: Credentials, pageUrl: string, field: SeoField, value: string): Promise<{ value: string; metaKey: string; resourceId: number }> {
  if (value.length > 320 || /<\/?script\b/iu.test(value)) throw new WordPressFailure("The proposed SEO field exceeds safe length or markup limits.", 400, "invalid_seo_value");
  const resource = await findWordPressResource(credentials, pageUrl);
  const metaKey = exposedMetaKey(resource, field);
  const updated = await pinnedWordPressRequest<WpResource>(credentials, `/wp-json/wp/v2/${resource.type}/${resource.id}`, "POST", { meta: { [metaKey]: value } });
  const saved = updated?.meta?.[metaKey];
  if (saved !== value) throw new WordPressFailure("WordPress did not confirm the exact SEO metadata value. Inspect the page before retrying.", 502, "wordpress_result_unknown");
  return { value, metaKey, resourceId: resource.id };
}

export async function readWordPressImageAlt(credentials: Credentials, imageUrl: string): Promise<{ value: string; resourceId: number }> {
  const site = normalizeWordPressSite(credentials.siteUrl);
  const requested = new URL(imageUrl);
  if (requested.origin !== site.origin) throw new WordPressFailure("Only images served from the connected WordPress origin can be edited.", 409, "wordpress_image_origin_unsupported");
  const filename = requested.pathname.split("/").filter(Boolean).at(-1);
  if (!filename) throw new WordPressFailure("Image URL has no media filename.", 400, "invalid_media_url");
  const rows = await pinnedWordPressRequest<Array<{ id: number; source_url: string; alt_text?: string }>>(credentials, `/wp-json/wp/v2/media?search=${encodeURIComponent(filename)}&context=edit&per_page=100`);
  const media = rows.find((row) => normalizedPagePath(row.source_url) === normalizedPagePath(imageUrl));
  if (!media) throw new WordPressFailure("No exact editable WordPress media item matches the audited image URL.", 404, "wordpress_media_not_found");
  return { value: media.alt_text ?? "", resourceId: media.id };
}

export async function writeWordPressImageAlt(credentials: Credentials, imageUrl: string, value: string): Promise<{ value: string; resourceId: number }> {
  if (value.length > 250 || /<\/?[a-z][^>]*>/iu.test(value)) throw new WordPressFailure("Image alt text must be plain text under 250 characters.", 400, "invalid_alt_text");
  const before = await readWordPressImageAlt(credentials, imageUrl);
  const updated = await pinnedWordPressRequest<{ id: number; alt_text?: string }>(credentials, `/wp-json/wp/v2/media/${before.resourceId}`, "POST", { alt_text: value });
  if (updated.id !== before.resourceId || updated.alt_text !== value) throw new WordPressFailure("WordPress did not confirm the exact image alt value. Inspect the page before retrying.", 502, "wordpress_result_unknown");
  return { value, resourceId: before.resourceId };
}

export async function readWordPressContent(credentials: Credentials, pageUrl: string): Promise<{ content: string; resourceId: number; type: "pages" | "posts" }> {
  const resource = await findWordPressResource(credentials, pageUrl);
  if (typeof resource.content?.raw !== "string") throw new WordPressFailure("WordPress did not expose editable raw content for this page.", 409, "wordpress_content_unsupported");
  return { content: resource.content.raw, resourceId: resource.id, type: resource.type };
}

export async function readWordPressPostForVerification(credentials: Credentials, postId: number): Promise<{ id: number; status: string; title: string | null; content: string | null; url: string | null; modified: string | null }> {
  if (!Number.isSafeInteger(postId) || postId <= 0) throw new WordPressFailure("A valid WordPress post ID is required.", 400, "invalid_post_id");
  const post = await pinnedWordPressRequest<WpResource & { status?: string; modified_gmt?: string }>(credentials, `/wp-json/wp/v2/posts/${postId}?context=edit`);
  if (post.id !== postId || typeof post.status !== "string" || !post.title || !post.content) throw new WordPressFailure("WordPress returned incomplete saved post data for verification.", 502, "invalid_verification_response");
  return { id: post.id, status: post.status, title: typeof post.title.raw === "string" ? post.title.raw : null, content: typeof post.content.raw === "string" ? post.content.raw : null, url: typeof post.link === "string" ? post.link : null, modified: typeof post.modified_gmt === "string" ? post.modified_gmt : null };
}

export async function writeWordPressContent(credentials: Credentials, pageUrl: string, content: string): Promise<{ resourceId: number; type: "pages" | "posts" }> {
  if (content.length > 1_000_000 || /<script\b[^>]*>[^]*?\b(?:eval|document\.cookie|fetch\s*\()|javascript:/iu.test(content)) throw new WordPressFailure("The proposed content is outside the safe link-editing limits.", 400, "unsafe_wordpress_content");
  const resource = await findWordPressResource(credentials, pageUrl);
  if (typeof resource.content?.raw !== "string") throw new WordPressFailure("WordPress did not expose editable raw content for this page.", 409, "wordpress_content_unsupported");
  const updated = await pinnedWordPressRequest<WpResource>(credentials, `/wp-json/wp/v2/${resource.type}/${resource.id}`, "POST", { content });
  if (updated.content?.raw !== content) throw new WordPressFailure("WordPress did not confirm the exact internal-link content update.", 502, "wordpress_result_unknown");
  return { resourceId: resource.id, type: resource.type };
}
