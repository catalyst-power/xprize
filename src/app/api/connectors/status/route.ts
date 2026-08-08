/**
 * GET /api/connectors/status
 *
 * Server-side connector status check for the currently logged-in supplier.
 * Resolves the acting user's own consent attestation from their session
 * cookie (never from process.env — this app is multi-user, so there is no
 * single "the" supplier attestation to bake into env vars) and forwards it
 * to the kernel's app-facing connector surface (ima-jin/imajin-ai#1540).
 *
 * `ConnectedServicesPanel` fetches this route instead of calling
 * `getUserConnectorStatus` / `fetchKernel` directly, so the session lookup
 * and attestation resolution happen in exactly one place (AGENTS.md §2, §3).
 *
 * Responses:
 *   401  No active session
 *   200  ConnectorStatus[] — live snapshot, never cached (AGENTS.md §4)
 *   502  Kernel call failed
 *
 * Issue: catalyst-power/xprize#36
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getUserConnectorStatus } from '@/lib/kernel/connectors';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const statuses = await getUserConnectorStatus(user.attestationId);
    return NextResponse.json(statuses, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[connectors/status] Kernel request failed:', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
