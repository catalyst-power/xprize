import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'No active session' }, { status: 401 });
  }
  return NextResponse.json(user);
}
