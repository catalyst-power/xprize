/**
 * POST /api/webhooks/stripe
 *
 * Paid-hook ingress for the Stripe Checkout link attached to a settlement
 * invoice (xprize#60 step 3). Handles `checkout.session.completed` only;
 * every other event type is acknowledged and ignored.
 *
 * This is a SEPARATE webhook endpoint from the kernel's own
 * `/pay/api/webhook` — that one settles the kernel's own generic pay ledger
 * via its own (unrelated) transaction/fair-manifest bookkeeping. Registering
 * this endpoint as an ADDITIONAL Stripe webhook subscription on the same
 * Stripe account (platform key, via the kernel's connector surface) lets
 * AgriFortress resolve `correlationId` from the session metadata and drive
 * settlement through the canonical `/pay/api/settle` endpoint itself, per
 * the issue's explicit instruction that both ingress paths must converge on
 * the same settlement step.
 *
 * Fails closed: an invalid/missing signature is rejected before the body is
 * trusted; a session with no `correlationId` metadata is ignored (not ours).
 *
 * Responses:
 *   400  Missing/invalid signature, or invalid JSON body
 *   200  { received: true } — always, once the signature verifies, per
 *        Stripe's webhook contract (retrying a handler error is Stripe's job,
 *        not this route's; internal errors are logged, not surfaced as 5xx,
 *        to avoid infinite Stripe retries on a permanently-invalid manifest).
 *
 * Issue: catalyst-power/xprize#60
 */

import { NextResponse, type NextRequest } from 'next/server';
import { verifyStripeSignature } from '@/lib/stripeSignature';
import { attemptSettleFromStripe } from '@/lib/settlementFlow';

export const dynamic = 'force-dynamic';

interface StripeCheckoutSessionCompletedEvent {
  type: string;
  data: {
    object: {
      id: string;
      metadata?: Record<string, string>;
    };
  };
}

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');
  if (!verifyStripeSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let event: StripeCheckoutSessionCompletedEvent;
  try {
    event = JSON.parse(rawBody) as StripeCheckoutSessionCompletedEvent;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (event.type !== 'checkout.session.completed') {
    return NextResponse.json({ received: true });
  }

  const metadata = event.data.object.metadata ?? {};
  const correlationId = metadata['correlationId'];
  if (!correlationId) {
    // Not one of ours — some other checkout session on the same platform account.
    return NextResponse.json({ received: true });
  }

  // A webhook delivery has no human session, so there is no per-user
  // attestation to borrow. attemptSettleFromStripe reads the lot via
  // getLotChainAsSelf — the app's own session-less app-service credential
  // (mint via POST /auth/api/apps/token/service, gated by requireAppAuth,
  // scoped to this app's own supply:read grant) — rather than reusing any
  // supplier's consent attestation. This retires the former
  // APP_ATTESTATION_ID stopgap entirely from this path (xprize#68; kernel
  // side confirmed end-to-end in ima-jin/imajin-ai#1800/#1802).
  const platformDid = process.env.PLATFORM_DID;
  if (!platformDid) {
    console.error('[agrifortress] stripe webhook: PLATFORM_DID not configured, cannot settle', {
      correlationId,
    });
    return NextResponse.json({ received: true });
  }

  const result = await attemptSettleFromStripe({ correlationId, fromDid: platformDid });
  if (result.state === 'error') {
    // Covers both a failed service-token mint/kernel read and a failed
    // settle attempt — attemptSettleFromStripe folds both into this error
    // state so a settlement failure is never silently swallowed. Stripe's
    // webhook contract still gets a 200 (see file header): retrying a
    // permanently-invalid manifest is not something a retry can fix, and
    // this log line is the durable record of the failure.
    console.error('[agrifortress] stripe webhook: settle failed', { correlationId, error: result.error });
  }

  return NextResponse.json({ received: true });
}
