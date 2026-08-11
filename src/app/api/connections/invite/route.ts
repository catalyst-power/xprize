/**
 * POST /api/connections/invite
 *
 * Server-side gateway for sending a connections-service invite (xprize#59)
 * to a trust-graph connection who's selected as an AgriFortress delivery
 * recipient but has never been active on AgriFortress before. Reuses the
 * kernel's connections invite create (link delivery only, for now — see
 * `createConnectionInvite` in src/lib/kernel/identity.ts for why 'email'
 * isn't wired up yet) rather than inventing a new invite mechanism, per
 * Ryan's addendum on the issue.
 *
 * Never calls the kernel from the browser — see AGENTS.md §2.
 *
 * Request body (JSON):
 *   recipientLabel  string  optional  Human-readable name, for the invite's note only
 *
 * Responses:
 *   401  No active session
 *   201  CreateInviteResponse from the kernel
 *   502  Kernel call failed (including the known cookie-vs-Bearer-auth gap
 *        documented on `createConnectionInvite` — surfaces as an honest
 *        error rather than a false "invite sent" claim)
 *
 * Issue: catalyst-power/xprize#59
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { createConnectionInvite } from '@/lib/kernel/identity';

export const dynamic = 'force-dynamic';

interface InviteRequestBody {
  recipientLabel?: string;
}

export async function POST(request: NextRequest) {
  // Session guard — kernel calls must be on behalf of an authenticated user.
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: InviteRequestBody = {};
  try {
    body = (await request.json()) as InviteRequestBody;
  } catch {
    // A body is optional — recipientLabel only sweetens the invite's note.
  }

  const note = body.recipientLabel
    ? `AgriFortress delivery pending for ${body.recipientLabel} — countersign to claim it.`
    : 'AgriFortress delivery pending — countersign to claim it.';

  try {
    const result = await createConnectionInvite({ delivery: 'link', note }, user.attestationId);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
