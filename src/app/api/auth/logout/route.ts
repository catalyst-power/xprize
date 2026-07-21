import { NextRequest, NextResponse } from 'next/server';
import { clearCookieOptions } from '@/lib/session';

const PUBLIC_URL = process.env.NEXT_PUBLIC_APP_URL ?? '';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const base = PUBLIC_URL || req.nextUrl.origin;
  const res = NextResponse.redirect(new URL('/', base));
  res.cookies.set(clearCookieOptions());
  return res;
}
