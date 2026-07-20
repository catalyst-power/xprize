import { NextResponse } from 'next/server';
import { requireAppAuth } from '@/src/lib/app-auth';

/**
 * GET /api/whoami
 *
 * Demo route: resolves the caller's identity via app-auth handshake.
 * Requires X-App-DID + X-App-Authorization (or Bearer <app-token>).
 *
 * Returns 401 if headers are missing or invalid.
 * Returns 200 with { appDid, userDid, scopes } on success.
 */
export async function GET(request: Request) {
  const result = await requireAppAuth(request);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }

  return NextResponse.json({
    appDid: result.auth.appDid,
    userDid: result.auth.userDid,
    scopes: result.auth.scopes,
  });
}
