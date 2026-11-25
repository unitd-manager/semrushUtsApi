import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type IntegrationTokens = { accessToken: string; refreshToken: string | null; expiresAt: number; scope: string; tokenType: string; accountId?: string | null; accountName?: string | null };
export type IntegrationCredentials = Record<string, string>;

function encryptionKey(): Buffer {
  const text = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!text) throw new Error("INTEGRATION_ENCRYPTION_KEY is required to store connected provider tokens.");
  const key = Buffer.from(text, "base64");
  if (key.length !== 32) throw new Error("INTEGRATION_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return key;
}

function encryptIntegrationValue(value: unknown): Record<string, string | number> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { version: 1, iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url") };
}

function decryptIntegrationValue(value: unknown): unknown {
  if (!value || typeof value !== "object") throw new Error("Integration token record is unavailable.");
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || typeof record.iv !== "string" || typeof record.tag !== "string" || typeof record.ciphertext !== "string") throw new Error("Integration token record has an unsupported format.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(record.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(record.tag, "base64url"));
  const plain = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, "base64url")), decipher.final()]).toString("utf8");
  return JSON.parse(plain) as unknown;
}

export function encryptIntegrationTokens(tokens: IntegrationTokens): Record<string, string | number> {
  return encryptIntegrationValue(tokens);
}

export function decryptIntegrationTokens(value: unknown): IntegrationTokens {
  const tokens = decryptIntegrationValue(value) as IntegrationTokens;
  if (typeof tokens.accessToken !== "string" || typeof tokens.expiresAt !== "number") throw new Error("Integration token record is invalid.");
  return tokens;
}

export function encryptIntegrationCredentials(credentials: IntegrationCredentials): Record<string, string | number> {
  return encryptIntegrationValue(credentials);
}

export function decryptIntegrationCredentials(value: unknown): IntegrationCredentials {
  const credentials = decryptIntegrationValue(value);
  if (!credentials || typeof credentials !== "object" || Array.isArray(credentials) || Object.values(credentials).some((entry) => typeof entry !== "string")) throw new Error("Integration credentials are invalid.");
  return credentials as IntegrationCredentials;
}

function oauthSigningKey(): Buffer { return encryptionKey(); }
export function signOAuthState(payload: { organizationId: string; userId: string; provider: string; nonce: string; issuedAt: number }): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", oauthSigningKey()).update(data).digest("base64url");
  return `${data}.${signature}`;
}

export function verifyOAuthState(value: string): { organizationId: string; userId: string; provider: string; nonce: string; issuedAt: number } | null {
  const [data, supplied, extra] = value.split(".");
  if (!data || !supplied || extra) return null;
  const expected = createHmac("sha256", oauthSigningKey()).update(data).digest();
  let actual: Buffer;
  try { actual = Buffer.from(supplied, "base64url"); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as { organizationId?: unknown; userId?: unknown; provider?: unknown; nonce?: unknown; issuedAt?: unknown };
    if (typeof payload.organizationId !== "string" || typeof payload.userId !== "string" || typeof payload.provider !== "string" || typeof payload.nonce !== "string" || typeof payload.issuedAt !== "number") return null;
    if (Date.now() - payload.issuedAt > 10 * 60_000 || payload.issuedAt > Date.now() + 30_000) return null;
    return payload as { organizationId: string; userId: string; provider: string; nonce: string; issuedAt: number };
  } catch { return null; }
}
