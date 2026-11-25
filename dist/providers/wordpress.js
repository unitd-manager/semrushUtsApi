import { createHash } from "node:crypto";
export class WordPressFailure extends Error {
    status;
    code;
    constructor(message, status, code) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = "WordPressFailure";
    }
}
export function normalizeWordPressSite(value) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new WordPressFailure("Enter a valid WordPress site URL.", 400, "invalid_site_url");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/")
        throw new WordPressFailure("Use the site's HTTPS origin only, without credentials, path, query, or fragment.", 400, "invalid_site_url");
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host) || host.includes(":"))
        throw new WordPressFailure("WordPress must be hosted on a public domain.", 400, "private_site_not_allowed");
    return new URL(url.origin);
}
function authHeader(username, applicationPassword) { return `Basic ${Buffer.from(`${username}:${applicationPassword.replaceAll(" ", "")}`).toString("base64")}`; }
async function jsonResponse(response) {
    let data = {};
    try {
        data = await response.json();
    }
    catch { /* handled below */ }
    if (!response.ok) {
        const status = response.status === 401 || response.status === 403 ? 403 : response.status >= 500 ? 502 : response.status;
        throw new WordPressFailure(status === 403 ? "WordPress rejected the Application Password or user permissions." : "WordPress REST API rejected the request.", status, status === 403 ? "credentials_or_permissions_rejected" : "wordpress_request_failed");
    }
    return data;
}
export async function verifyWordPressCredentials(siteUrl, username, applicationPassword, request = fetch) {
    const site = normalizeWordPressSite(siteUrl);
    if (!username.trim() || !applicationPassword.trim())
        throw new WordPressFailure("WordPress username and Application Password are required.", 400, "credentials_required");
    let response;
    try {
        response = await request(new URL("/wp-json/wp/v2/users/me?context=edit", site), { headers: { authorization: authHeader(username, applicationPassword), accept: "application/json" }, signal: AbortSignal.timeout(15_000), redirect: "error" });
    }
    catch {
        throw new WordPressFailure("WordPress could not be reached using this HTTPS site URL.", 502, "wordpress_unavailable");
    }
    const profile = await jsonResponse(response);
    if (typeof profile.id !== "number" || typeof profile.name !== "string")
        throw new WordPressFailure("WordPress returned an invalid account profile.", 502, "invalid_response");
    return { siteUrl: site.origin, userId: profile.id, accountName: profile.name };
}
export async function createWordPressPost(input, request = fetch) {
    const site = normalizeWordPressSite(input.siteUrl);
    let response;
    try {
        response = await request(new URL("/wp-json/wp/v2/posts", site), { method: "POST", headers: { authorization: authHeader(input.username, input.applicationPassword), "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ title: input.title, content: input.content, status: input.status }), signal: AbortSignal.timeout(25_000), redirect: "error" });
    }
    catch {
        throw new WordPressFailure("WordPress did not return a publish result. Check the CMS before retrying.", 502, "publish_result_unknown");
    }
    const post = await jsonResponse(response);
    if (typeof post.id !== "number" || typeof post.status !== "string")
        throw new WordPressFailure("WordPress accepted the request but returned no post reference; verify it in the CMS before retrying.", 502, "publish_result_unknown");
    return { id: post.id, status: post.status, url: typeof post.link === "string" ? post.link : null, modified: typeof post.modified_gmt === "string" ? post.modified_gmt : new Date().toISOString() };
}
export function evaluateWordPressPostVerification(actual, expected) {
    let actualUrl = null;
    try {
        if (actual.url)
            actualUrl = new URL(actual.url);
    }
    catch {
        actualUrl = null;
    }
    const origin = normalizeWordPressSite(expected.siteUrl).origin;
    const checks = { postId: actual.id === expected.id, status: actual.status === expected.status, title: actual.title === expected.title, content: actual.content !== null && createContentDigest(actual.content) === expected.contentDigest, url: Boolean(actualUrl && actualUrl.origin === origin && actualUrl.protocol === "https:") };
    return { verified: Object.values(checks).every(Boolean), checks };
}
function createContentDigest(content) {
    return createHash("sha256").update(content).digest("hex");
}
