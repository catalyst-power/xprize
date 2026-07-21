/**
 * User session management for AgriFortress.
 *
 * Users authenticate via the Imajin kernel consent flow. The kernel redirects
 * back with ?attestation_id=&user_did=, the app mints a short-lived session
 * cookie, and all subsequent requests read it via getSession().
 *
 * Cookie: httpOnly HS256 JWT signed with SESSION_SECRET (7-day TTL).
 *
 * Ported from PR #9 (feat/2-app-scaffold) with naming adjusted to avoid
 * collision with src/lib/kernel/auth.ts (server-to-kernel auth).
 */

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const COOKIE_NAME = 'imajin_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionUser {
  did: string;
  displayName: string;
  handle: string;
  avatar?: string;
  attestationId: string;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET env var is not set');
  return new TextEncoder().encode(secret);
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({ user })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload.user as SessionUser;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Request helper
// ---------------------------------------------------------------------------

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

// ---------------------------------------------------------------------------
// Cookie option factories
// ---------------------------------------------------------------------------

export function sessionCookieOptions(token: string) {
  return {
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: SESSION_MAX_AGE,
    path: '/',
  };
}

export function clearCookieOptions() {
  return {
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 0,
    path: '/',
  };
}
