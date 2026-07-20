import { NextResponse } from 'next/server';
import { getSession } from '@/src/lib/auth';

/**
 * GET /api/whoami
 *
 * Returns the current session user (did, displayName, handle, avatar, attestationId)
 * or 401 if no session cookie is present/valid.
 */
export async function GET() {
  const user = await getSession();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json(user);
}
