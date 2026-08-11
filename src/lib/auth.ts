/**
 * Single-user passphrase authentication with an encrypted (iron-session)
 * cookie.
 *
 * - APP_PASSWORD set   → login required everywhere (pages + API).
 * - APP_PASSWORD unset → auth disabled for zero-setup local development;
 *   the UI shows a warning. Always set it before deploying.
 *
 * SESSION_SECRET: 32+ random chars used to seal the cookie
 * (openssl rand -base64 32). Falls back to a dev-only static value ONLY
 * when auth is disabled.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  authenticated?: boolean;
}

export function authEnabled(): boolean {
  return !!process.env.APP_PASSWORD;
}

export function sessionOptions(): SessionOptions {
  const secret = process.env.SESSION_SECRET;
  if (!secret && authEnabled()) {
    throw new Error(
      "SESSION_SECRET must be set when APP_PASSWORD is set (openssl rand -base64 32)",
    );
  }
  return {
    cookieName: "meridian_session",
    password: secret ?? "dev-only-secret-not-for-production-use-1234",
    ttl: 60 * 60 * 24 * 14, // 14 days
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  };
}

export async function getSession() {
  const store = await cookies();
  return getIronSession<SessionData>(store, sessionOptions());
}

export async function isAuthenticated(): Promise<boolean> {
  if (!authEnabled()) return true;
  const session = await getSession();
  return session.authenticated === true;
}

/** Constant-time password check on SHA-256 digests. */
export function verifyPassword(candidate: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// -------- naive login rate limiting (single user, in-memory) --------

const attempts: number[] = [];

export function loginAllowed(): boolean {
  const cutoff = Date.now() - 15 * 60_000;
  while (attempts.length > 0 && attempts[0] < cutoff) attempts.shift();
  return attempts.length < 10;
}

export function recordLoginAttempt(): void {
  attempts.push(Date.now());
}
