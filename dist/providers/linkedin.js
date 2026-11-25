export class LinkedInFailure extends Error {
    status;
    code;
    constructor(message, status, code) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = "LinkedInFailure";
    }
}
export function linkedInConfig(overrides) { return { clientId: overrides?.clientId ?? process.env.LINKEDIN_CLIENT_ID?.trim() ?? "", clientSecret: overrides?.clientSecret ?? process.env.LINKEDIN_CLIENT_SECRET?.trim() ?? "", redirectUri: overrides?.redirectUri ?? process.env.LINKEDIN_REDIRECT_URI?.trim() ?? "", version: overrides?.version ?? (process.env.LINKEDIN_API_VERSION?.trim() || "202609") }; }
export function linkedInAuthorizationUrl(config, state) {
    if (!config.clientId || !config.clientSecret || !config.redirectUri)
        throw new LinkedInFailure("LinkedIn OAuth is not configured.", 503, "not_configured");
    const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
    url.search = new URLSearchParams({ response_type: "code", client_id: config.clientId, redirect_uri: config.redirectUri, state, scope: "openid profile w_member_social" }).toString();
    return url.toString();
}
async function checkedJson(response) {
    if (!response.ok)
        throw new LinkedInFailure(response.status === 401 ? "LinkedIn authorization expired or was rejected." : response.status === 403 ? "LinkedIn denied this action. Check granted products and scopes." : "LinkedIn could not complete the request.", response.status, response.status === 401 ? "reauthorization_required" : "provider_request_failed");
    try {
        return await response.json();
    }
    catch {
        throw new LinkedInFailure("LinkedIn returned an unreadable response.", 502, "invalid_response");
    }
}
export async function exchangeLinkedInCode(config, code, request = fetch) {
    let response;
    try {
        response = await request("https://www.linkedin.com/oauth/v2/accessToken", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri }), signal: AbortSignal.timeout(15_000) });
    }
    catch {
        throw new LinkedInFailure("LinkedIn token service could not be reached.", 502, "provider_unavailable");
    }
    const data = await checkedJson(response);
    if (typeof data.access_token !== "string" || typeof data.expires_in !== "number")
        throw new LinkedInFailure("LinkedIn did not return a usable access token.", 502, "invalid_response");
    return { accessToken: data.access_token, refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null, expiresAt: Date.now() + data.expires_in * 1000, scope: typeof data.scope === "string" ? data.scope : "openid profile w_member_social", tokenType: "Bearer" };
}
function headers(tokens, version) { if (!/^20\d{4}$/u.test(version))
    throw new LinkedInFailure("LinkedIn API version must use YYYYMM format.", 503, "configuration_invalid"); return { authorization: `Bearer ${tokens.accessToken}`, "content-type": "application/json", "linkedin-version": version, "x-restli-protocol-version": "2.0.0" }; }
export async function linkedInProfile(tokens, request = fetch, version = linkedInConfig().version) {
    let response;
    try {
        response = await request("https://api.linkedin.com/v2/userinfo", { headers: headers(tokens, version), signal: AbortSignal.timeout(15_000) });
    }
    catch {
        throw new LinkedInFailure("LinkedIn profile could not be reached.", 502, "provider_unavailable");
    }
    const data = await checkedJson(response);
    if (typeof data.sub !== "string")
        throw new LinkedInFailure("LinkedIn profile response did not include a member ID.", 502, "invalid_response");
    return { id: `urn:li:person:${data.sub}`, name: [data.given_name, data.family_name].filter((value) => typeof value === "string").join(" ") || "LinkedIn member" };
}
export async function publishLinkedInText(tokens, author, commentary, request = fetch, version = linkedInConfig().version) {
    let response;
    try {
        response = await request("https://api.linkedin.com/rest/posts", { method: "POST", headers: headers(tokens, version), body: JSON.stringify({ author, commentary, visibility: "PUBLIC", distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false }), signal: AbortSignal.timeout(25_000) });
    }
    catch {
        throw new LinkedInFailure("The LinkedIn publish response was not received; check your LinkedIn posts before retrying.", 502, "publish_result_unknown");
    }
    let data = {};
    if (response.status !== 201)
        data = await checkedJson(response);
    else if (!response.ok)
        data = await checkedJson(response);
    else {
        try {
            data = await response.json();
        }
        catch { /* LinkedIn normally returns the post URN in x-restli-id. */ }
    }
    const id = response.headers.get("x-restli-id") ?? (typeof data.id === "string" ? data.id : null);
    if (!id)
        throw new LinkedInFailure("LinkedIn accepted the request but did not return a post ID; verify the post in LinkedIn before retrying.", 502, "publish_result_unknown");
    return { id, url: `https://www.linkedin.com/feed/update/${encodeURIComponent(id)}/`, publishedAt: new Date().toISOString() };
}
export async function linkedInSocialActions(tokens, postUrn, request = fetch, version = linkedInConfig().version) {
    if (!/^(urn:li:share:|urn:li:ugcPost:)[A-Za-z0-9_-]+$/u.test(postUrn))
        throw new LinkedInFailure("Saved LinkedIn post ID is invalid.", 400, "invalid_post_id");
    const endpoint = `https://api.linkedin.com/rest/socialActions/${encodeURIComponent(postUrn)}`;
    let response;
    try {
        response = await request(endpoint, { headers: headers(tokens, version), signal: AbortSignal.timeout(15_000) });
    }
    catch {
        throw new LinkedInFailure("LinkedIn engagement data could not be reached.", 502, "provider_unavailable");
    }
    const data = await checkedJson(response);
    const likesSummary = data.likesSummary && typeof data.likesSummary === "object" ? data.likesSummary : {};
    const commentsSummary = data.commentsSummary && typeof data.commentsSummary === "object" ? data.commentsSummary : {};
    return { postUrn, likes: typeof likesSummary.totalLikes === "number" ? likesSummary.totalLikes : 0, comments: typeof commentsSummary.totalFirstLevelComments === "number" ? commentsSummary.totalFirstLevelComments : 0, observedAt: new Date().toISOString(), source: "LinkedIn socialActions" };
}
