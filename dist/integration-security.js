import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
function encryptionKey() {
    const text = process.env.INTEGRATION_ENCRYPTION_KEY;
    if (!text)
        throw new Error("INTEGRATION_ENCRYPTION_KEY is required to store connected provider tokens.");
    const key = Buffer.from(text, "base64");
    if (key.length !== 32)
        throw new Error("INTEGRATION_ENCRYPTION_KEY must decode to exactly 32 bytes.");
    return key;
}
function encryptIntegrationValue(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return { version: 1, iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url") };
}
function decryptIntegrationValue(value) {
    if (!value || typeof value !== "object")
        throw new Error("Integration token record is unavailable.");
    const record = value;
    if (record.version !== 1 || typeof record.iv !== "string" || typeof record.tag !== "string" || typeof record.ciphertext !== "string")
        throw new Error("Integration token record has an unsupported format.");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(record.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(record.tag, "base64url"));
    const plain = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, "base64url")), decipher.final()]).toString("utf8");
    return JSON.parse(plain);
}
export function encryptIntegrationTokens(tokens) {
    return encryptIntegrationValue(tokens);
}
export function decryptIntegrationTokens(value) {
    const tokens = decryptIntegrationValue(value);
    if (typeof tokens.accessToken !== "string" || typeof tokens.expiresAt !== "number")
        throw new Error("Integration token record is invalid.");
    return tokens;
}
export function encryptIntegrationCredentials(credentials) {
    return encryptIntegrationValue(credentials);
}
export function decryptIntegrationCredentials(value) {
    const credentials = decryptIntegrationValue(value);
    if (!credentials || typeof credentials !== "object" || Array.isArray(credentials) || Object.values(credentials).some((entry) => typeof entry !== "string"))
        throw new Error("Integration credentials are invalid.");
    return credentials;
}
function oauthSigningKey() { return encryptionKey(); }
export function signOAuthState(payload) {
    const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", oauthSigningKey()).update(data).digest("base64url");
    return `${data}.${signature}`;
}
export function verifyOAuthState(value) {
    const [data, supplied, extra] = value.split(".");
    if (!data || !supplied || extra)
        return null;
    const expected = createHmac("sha256", oauthSigningKey()).update(data).digest();
    let actual;
    try {
        actual = Buffer.from(supplied, "base64url");
    }
    catch {
        return null;
    }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
        return null;
    try {
        const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
        if (typeof payload.organizationId !== "string" || typeof payload.userId !== "string" || typeof payload.provider !== "string" || typeof payload.nonce !== "string" || typeof payload.issuedAt !== "number")
            return null;
        if (Date.now() - payload.issuedAt > 10 * 60_000 || payload.issuedAt > Date.now() + 30_000)
            return null;
        return payload;
    }
    catch {
        return null;
    }
}
