/**
 * GET /api/connectors/quickbooks/connect
 *
 * The "Connect QuickBooks" button's target. A plain browser navigation can't
 * carry the app's Bearer token, so this in-app route makes the app-auth'd
 * call to the kernel server-side (same transport as every other kernel call
 * in this app — AGENTS.md §2) and forwards the resulting OAuth redirect to
 * the browser.
 *
 * Post ima-jin/imajin-ai#1705: AgriFortress owns the Intuit app registration
 * (clientId/clientSecret/redirectUri), sealed in the app DID's vault. The
 * kernel's `createConnectHandler` + `resolveConfigDidFromAppAuth` resolve
 * those credentials from the app-auth headers this route sends, sign OAuth
 * state with both the app DID and the acting user DID, and redirect to
 * Intuit. The callback (handled entirely by the kernel) exchanges the code
 * and seals the resulting tokens at the user's own DID — AgriFortress never
 * receives or stores a client secret or an OAuth token.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { fetchKernel } from '@/lib/kernel/client';

interface KernelConnectResponse {
  redirectUrl?: string;
}

function redirectToDashboard(req: NextRequest, query = ''): NextResponse {
  const base = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, '');
  return NextResponse.redirect(new URL(`/dashboard${query}`, base));
}

function redirectHome(req: NextRequest): NextResponse {
  const base = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, '');
  return NextResponse.redirect(new URL('/', base));
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const user = await getSession();
  if (!user) {
    return redirectHome(req);
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, '');
  const returnTo = `${appUrl}/dashboard`;
  const qs = new URLSearchParams({ onBehalfOf: user.did, returnTo });

  let res: Response;
  try {
    res = await fetchKernel(`/quickbooks/api/connect?${qs.toString()}`, {
      method: 'POST',
      redirect: 'manual',
    });
  } catch (err) {
    console.error('[connectors/quickbooks/connect] Kernel request failed:', err);
    return redirectToDashboard(req, '?connect_error=quickbooks');
  }

  // The kernel's connect handler redirects the browser straight to Intuit.
  const location = res.headers.get('location');
  if (location) {
    return NextResponse.redirect(location);
  }

  // Fallback shape: a 200 body carrying the redirect target explicitly.
  if (res.ok) {
    const body = await res.json().catch(() => null) as KernelConnectResponse | null;
    if (body?.redirectUrl) {
      return NextResponse.redirect(body.redirectUrl);
    }
  }

  console.error(
    '[connectors/quickbooks/connect] Kernel did not return a redirect:',
    res.status,
    res.statusText,
  );
  return redirectToDashboard(req, '?connect_error=quickbooks');
}
