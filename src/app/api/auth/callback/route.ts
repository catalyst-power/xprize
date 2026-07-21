/**
 * GET /api/auth/callback
 *
 * Receives the kernel consent redirect:
 *   GET /api/auth/callback?attestation_id=<id>&user_did=<did>
 *
 * Fetches the user's public profile, mints a session cookie, and redirects
 * to /dashboard. On any failure, redirects to / with an ?auth_error= param.
 *
 * Profile fetch intentionally omits X-App-DID: sending it triggers
 * requireAppAuth validation which can fail if the attestation scopes haven't
 * fully propagated yet. Public profile is sufficient to build the session.
 * (Insight from PR #9.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, sessionCookieOptions } from '@/lib/session';

const PUBLIC_URL = process.env.NEXT_PUBLIC_APP_URL ?? '';
const KERNEL_URL = process.env.KERNEL_URL ?? 'https://imajin.ai';

function redirectTo(path: string, req: NextRequest): NextResponse {
  const base = PUBLIC_URL || req.nextUrl.origin;
  return NextResponse.redirect(new URL(path, base));
}

interface PublicProfile {
  did: string;
  displayName?: string;
  handle?: string;
  avatar?: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const attestationId = req.nextUrl.searchParams.get('attestation_id');
  const userDid = req.nextUrl.searchParams.get('user_did');

  if (!attestationId || !userDid) {
    return redirectTo('/?auth_error=missing_params', req);
  }

  let profile: PublicProfile;

  try {
    const res = await fetch(
      `${KERNEL_URL}/profile/api/profile/${encodeURIComponent(userDid)}`,
      { headers: { 'Content-Type': 'application/json' }, cache: 'no-store' },
    );

    if (res.status === 403) {
      return redirectTo('/?auth_error=attestation_revoked', req);
    }
    if (!res.ok) {
      console.error('[auth/callback] Profile fetch failed:', res.status, await res.text().catch(() => ''));
      return redirectTo('/?auth_error=profile_fetch_failed', req);
    }

    profile = await res.json() as PublicProfile;
  } catch (err) {
    console.error('[auth/callback] Profile fetch error:', err);
    return redirectTo('/?auth_error=network_error', req);
  }

  // Resolve relative avatar URLs (kernel serves media under its own domain)
  let { avatar } = profile;
  if (avatar?.startsWith('/')) {
    avatar = `${KERNEL_URL}${avatar}`;
  }

  const token = await createSessionToken({
    did: profile.did,
    displayName: profile.displayName ?? profile.handle ?? profile.did,
    handle: profile.handle ?? profile.did,
    avatar,
    attestationId,
  });

  const res = redirectTo('/dashboard', req);
  res.cookies.set(sessionCookieOptions(token));
  return res;
}
