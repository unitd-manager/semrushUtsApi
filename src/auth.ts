import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "./db.js";

const scrypt = promisify(scryptCallback);
const secret = process.env.SESSION_SECRET;
if (process.env.NODE_ENV === "production" && (!secret || secret.length < 32 || secret === "replace-with-a-random-secret-of-at-least-32-characters")) throw new Error("Set a unique SESSION_SECRET of at least 32 characters before running in production");
const signingSecret = secret && secret.length >= 32 ? secret : "local-development-only-change-this-secret-before-deploy";
const cookieName = "searchlight_session";
const tokenDurationSeconds = 60 * 60 * 12;

function b64(value: string | Buffer): string { return Buffer.from(value).toString("base64url"); }
function signature(input: string): string { return createHmac("sha256", signingSecret).update(input).digest("base64url"); }

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64) as Buffer;
  return `${salt.toString("base64url")}.${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, saved: string): Promise<boolean> {
  const [saltText, keyText] = saved.split(".");
  if (!saltText || !keyText) return false;
  const salt = Buffer.from(saltText, "base64url");
  const expected = Buffer.from(keyText, "base64url");
  const actual = await scrypt(password, salt, expected.length) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function issueSession(userId: string, organizationId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64(JSON.stringify({ sub: userId, org: organizationId, iat: now, exp: now + tokenDurationSeconds }));
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${signature(unsigned)}`;
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: tokenDurationSeconds * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(cookieName, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" });
}

type Claims = { sub: string; org: string; exp: number };
export type AuthenticatedRequest = Request & { auth?: { userId: string; organizationId: string; role: string } };

function readClaims(token?: string): Claims | undefined {
  if (!token) return;
  const parts = token.split(".");
  if (parts.length !== 3) return;
  const [header, payload, supplied] = parts;
  const expected = signature(`${header}.${payload}`);
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as Claims;
    if (!claims.sub || !claims.org || claims.exp <= Math.floor(Date.now() / 1000)) return;
    return claims;
  } catch { return; }
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[cookieName] as string | undefined;
  const claims = readClaims(token);
  if (!claims) { res.status(401).json({ error: { code: "unauthenticated", message: "Sign in to continue." } }); return; }
  try {
    const membership = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: claims.org, userId: claims.sub } },
      select: { role: true },
    });
    if (!membership) { res.status(401).json({ error: { code: "membership_missing", message: "Organization access is no longer active." } }); return; }
    req.auth = { userId: claims.sub, organizationId: claims.org, role: membership.role };
    next();
  } catch (error) { next(error); }
}

export function requireRole(...roles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.auth || !roles.includes(req.auth.role)) { res.status(403).json({ error: { code: "forbidden", message: "Your role cannot perform this action." } }); return; }
    next();
  };
}
