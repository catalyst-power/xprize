/**
 * POST /api/connections/invite
 *
 * Server-side gateway for sending a connections-service invite to an
 * AgriFortress delivery recipient. Two shapes:
 *   - A trust-graph connection who's never been active on AgriFortress
 *     before (xprize#59) — a link invite, keyed by `recipientLabel` only.
 *   - Someone who isn't on Imajin at all (xprize#86) — an email invite,
 *     keyed by `toEmail`. The kernel mints a claimable-stub DID for a
 *     brand-new email and silently resolves to the existing stub for a
 *     repeat one (ima-jin/imajin-ai PR #1836) — this route never tries to
 *     tell the two apart and must not imply it in behavior or copy
 *     (no-disclosure invariant).
 *
 * `scopeDid` (the AgriFortress org DID) is resolved server-side from
 * `APP_DID` — the same env var `src/lib/kernel/client.ts` uses to identify
 * this app to the kernel — never accepted from the client. `pendingAttestationId`
 * is passed straight through from the caller: `DeliveryGesture.tsx` only ever
 * supplies the ID of the delivery attestation it just created via
 * `POST /api/inference/confirm`, so by construction the attestation always
 * exists before this call (xprize#86 ordering requirement). Both are
 * optional/additive (ima-jin/imajin-ai PR #1837) — `createConnectionInvite`
 * gracefully degrades to a context-less invite if the kernel rejects them
 * (migrations 0093/0094 not deployed yet).
 *
 * Never calls the kernel from the browser — see AGENTS.md §2.
 *
 * Request body (JSON):
 *   recipientLabel        string  optional  Human-readable name, for the invite's note only (link path)
 *   toEmail               string  optional  Recipient email — switches this to an email invite (xprize#86)
 *   pendingAttestationId  string  optional  The delivery attestation already created for this recipient
 *
 * Responses:
 *   400  toEmail is present but not a valid email address
 *   401  No active session
 *   201  CreateInviteResponse from the kernel
 *   502  Kernel call failed — logged server-side (never swallowed, xprize#77)
 *        and surfaced as an honest error rather than a false "invite sent"
 *        claim. The caller (`DeliveryGesture.tsx`) treats this as best-effort
 *        and non-blocking for the delivery confirm outcome, but shows a
 *        small non-blocking UI note when it happens.
 *
 * Issue: catalyst-power/xprize#59, catalyst-power/xprize#77, catalyst-power/xprize#86
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { createConnectionInvite } from '@/lib/kernel/identity';
import { isValidRecipientEmail } from '@/lib/recipientEmail';

export const dynamic = 'force-dynamic';

interface InviteRequestBody {
  recipientLabel?: string;
  toEmail?: string;
  pendingAttestationId?: string;
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

  const toEmail = body.toEmail?.trim();
  if (toEmail !== undefined && toEmail !== '' && !isValidRecipientEmail(toEmail)) {
    // Client-side validation (DeliveryGesture.tsx) already gates the confirm
    // gesture on a well-formed address, but this call must never trust that
    // alone (xprize#86: "validate format client- and server-side").
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
  }

  const note = body.recipientLabel
    ? `AgriFortress delivery pending for ${body.recipientLabel} — countersign to claim it.`
    : 'AgriFortress delivery pending — countersign to claim it.';

  // The AgriFortress org DID ("scopeDid") is resolved the same way the app
  // resolves its own identity everywhere else (see src/lib/kernel/client.ts,
  // src/app/api/attestations/[id]/sign/route.ts) — never from the request body.
  const scopeDid = process.env.APP_DID;

  try {
    const result = await createConnectionInvite(
      {
        delivery: toEmail !== undefined && toEmail !== '' ? 'email' : 'link',
        ...(toEmail !== undefined && toEmail !== '' ? { toEmail } : {}),
        note,
        ...(scopeDid !== undefined ? { scopeDid } : {}),
        ...(body.pendingAttestationId !== undefined ? { pendingAttestationId: body.pendingAttestationId } : {}),
      },
      user.attestationId,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Stop swallowing the error (xprize#77): a failed best-effort invite must
    // still be visible to operators, even though it never blocks the delivery
    // confirm outcome (claim boundary, AGENTS.md §4).
    console.error('[connections/invite] Kernel invite create failed:', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
