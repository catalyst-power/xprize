/**
 * Middleware — route protection.
 *
 * Checks for the presence of the imajin_session cookie before allowing
 * access to protected routes. Cookie presence is a fast gate; full JWT
 * verification happens in the destination page (DashboardPage) so an
 * expired or tampered cookie still results in a redirect.
 */

import { NextRequest, NextResponse } from 'next/server';

const PROTECTED_PREFIXES = ['/dashboard'];

export function proxy(req: NextRequest): NextResponse {
  const isProtected = PROTECTED_PREFIXES.some(prefix =>
    req.nextUrl.pathname.startsWith(prefix),
  );

  if (!isProtected) {
    return NextResponse.next();
  }

  const session = req.cookies.get('imajin_session');
  if (!session) {
    const loginUrl = new URL('/', req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};

// Default export required by the proxy convention
export default proxy;
