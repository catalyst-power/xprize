import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, sessionCookieOptions } from '@/src/lib/auth';

// Use public URL for redirects (behind Caddy, req.url is localhost:port)
const PUBLIC_URL = process.env.NEXT_PUBLIC_APP_URL || '';

function redirectTo(path: string, req: NextRequest) {
  const base = PUBLIC_URL || req.nextUrl.origin;
  return NextResponse.redirect(new URL(path, base));
}

export async function GET(req: NextRequest) {
  const attestationId = req.nextUrl.searchParams.get('attestation_id');
  const userDid = req.nextUrl.searchParams.get('user_did');

  if (!attestationId || !userDid) {
    return redirectTo('/?auth_error=missing_params', req);
  }

  const authUrl = process.env.IMAJIN_AUTH_URL;
  const appDid = process.env.IMAJIN_APP_DID;

  if (!authUrl || !appDid) {
    return redirectTo('/?auth_error=misconfigured', req);
  }

  let profileData: {
    did: string;
    displayName?: string;
    handle?: string;
    avatar?: string;
  };

  try {
    // Fetch public profile — no app auth headers needed here.
    // Sending X-App-DID triggers requireAppAuth validation which can fail
    // if scopes/attestation aren't fully propagated yet.
    const profileRes = await fetch(
      `${authUrl}/profile/api/profile/${encodeURIComponent(userDid)}`,
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (profileRes.status === 403) {
      return redirectTo('/?auth_error=attestation_revoked', req);
    }

    if (!profileRes.ok) {
      const body = await profileRes.text().catch(() => '');
      console.error('Profile fetch failed:', profileRes.status, body);
      return redirectTo('/?auth_error=profile_fetch_failed', req);
    }

    profileData = await profileRes.json();
  } catch (err) {
    console.error('Profile fetch error:', err);
    return redirectTo('/?auth_error=network_error', req);
  }

  // Resolve relative avatar URLs against the kernel
  let avatar = profileData.avatar;
  if (avatar && avatar.startsWith('/')) {
    avatar = `${authUrl}${avatar}`;
  }

  const token = await createSessionToken({
    did: profileData.did,
    displayName: profileData.displayName ?? profileData.handle ?? profileData.did,
    handle: profileData.handle ?? profileData.did,
    avatar,
    attestationId,
  });

  const res = redirectTo('/dashboard', req);
  res.cookies.set(sessionCookieOptions(token));
  return res;
}
