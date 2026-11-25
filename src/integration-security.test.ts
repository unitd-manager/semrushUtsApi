import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptIntegrationCredentials, decryptIntegrationTokens, encryptIntegrationCredentials, encryptIntegrationTokens, signOAuthState, verifyOAuthState } from "./integration-security.js";

const token = { accessToken: "access-test", refreshToken: "refresh-test", expiresAt: Date.now() + 60_000, scope: "readonly", tokenType: "Bearer", accountId: "property-123", accountName: "Test property" };

describe("integration credential security", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("encrypts OAuth tokens and rejects ciphertext tampering", () => {
    vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    const encrypted = encryptIntegrationTokens(token);
    expect(JSON.stringify(encrypted)).not.toContain(token.accessToken);
    expect(decryptIntegrationTokens(encrypted)).toEqual(token);
    expect(() => decryptIntegrationTokens({ ...encrypted, ciphertext: `${encrypted.ciphertext}x` })).toThrow();
  });

  it("encrypts workspace provider credentials without exposing their values", () => {
    vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", Buffer.alloc(32, 8).toString("base64"));
    const credentials = { apiKey: "provider-secret", model: "gpt-test" };
    const encrypted = encryptIntegrationCredentials(credentials);
    expect(JSON.stringify(encrypted)).not.toContain(credentials.apiKey);
    expect(decryptIntegrationCredentials(encrypted)).toEqual(credentials);
    expect(() => decryptIntegrationCredentials({ ...encrypted, tag: `${encrypted.tag}x` })).toThrow();
  });

  it("signs OAuth state and rejects altered, expired, or other-key state", () => {
    vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
    const payload = { organizationId: "org-a", userId: "user-a", provider: "google-analytics", nonce: "nonce-a", issuedAt: Date.now() };
    const state = signOAuthState(payload);
    expect(verifyOAuthState(state)).toMatchObject(payload);
    expect(verifyOAuthState(`${state}x`)).toBeNull();
    expect(verifyOAuthState(signOAuthState({ ...payload, issuedAt: Date.now() - 11 * 60_000 }))).toBeNull();
    vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", Buffer.alloc(32, 10).toString("base64"));
    expect(verifyOAuthState(state)).toBeNull();
  });
});
