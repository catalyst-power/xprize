import { NextRequest, NextResponse } from 'next/server';
import { clearCookieOptions } from '@/src/lib/auth';

// Behind Caddy, req.url resolves to localhost:port. Use public URL for redirects.
const PUBLIC_URL = process.env.NEXT_PUBLIC_APP_URL || '';

export async function POST(req: NextRequest) {
  const base = PUBLIC_URL || req.nextUrl.origin;
  const res = NextResponse.redirect(new URL('/', base));
  res.cookies.set(clearCookieOptions());
  return res;
}
